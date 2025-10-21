/*

Quon Routine の定義

Quon Routine は、リソースの初期化 / 解放処理を記述するもの

- 基本的には async
- それぞれの node は "node result" を持つ (undefined | T)
- ある node 以降の処理は、その node result に依存すると見てよい。
- node は自由なタイミングで自身の node result を undefined -> v, v -> undefined に変更できる。 (それぞれ CREATE v / DELETE と呼称する。)
  - CREATE v の場合、node result は v となり、以降の処理は v に依存する
  - DELETE の場合、routine の処理はその node call に巻き戻り (ここで各種 node の解放処理を実行する)、以降の処理を保留する。
    - 次に CREATE v が発生した場合、そこで得られた v を node result として以降の処理を再開する
*/

import { TaskQueue } from './task-queue';

type QUON_NODE_RESULT = any;

/**
 * Quon Routine のコンテキスト型
 */
type QUON_ROUTINE_CONTEXT = {
  currentNodeId: number;
  history: Map<number, QUON_NODE_RESULT>;
  disposers: Map<number, () => Promise<void>>;
  targetNodeId: number;
  targetNodeResult?: QUON_NODE_RESULT;
  // node result を生成する (現在 pend している位置が nodeId と異なる場合は noop)
  createFunction(nodeId: number, result: QUON_NODE_RESULT): void;
  // node result を削除する (依存する処理が dispose されるまで待機する Promise)
  deleteFunction(nodeId: number): Promise<void>;
  userContext: Record<symbol, any>;
};

let QUON_GLOBAL_ROUTINE_CONTEXT: QUON_ROUTINE_CONTEXT | null = null;

function QUON_GET_CURRENT_ROUTINE_CONTEXT(): QUON_ROUTINE_CONTEXT {
  if (QUON_GLOBAL_ROUTINE_CONTEXT === null) {
    console.error(
      '[Quon] Incalid call of Quon Routine. You should call it inside a Quon Routine.'
    );
    throw new Error('[Quon] Quon Routine Context is not set');
  }
  return QUON_GLOBAL_ROUTINE_CONTEXT;
}

export const QUON_EMPTY = Symbol('QUON_EMPTY');

// Quon Routine 内で使用する node を作成する
// 直接 Quon Context を触らないので安心
// 具体的には、targetNodeId が currentNodeId と等しい時、result を結果として返す
// targetNodeId の方が大きいときは history から結果を得る
// targetNodeId の方が小さいときは、recipe を実行し、value が帰ったならそれを node result として実行。empty が帰ったなら一旦 routine を保留し、次の CREATE v を待つ
export function QUON_CREATE_NODE<T>(
  recipe: (
    createFunction: (nodeResult: T) => void,
    deleteFunction: () => Promise<void>
  ) =>
    | {
        type: 'empty';
        disposer: () => Promise<void>;
      }
    | {
        type: 'value';
        disposer: () => Promise<void>;
        value: T;
      }
): T {
  const context = QUON_GET_CURRENT_ROUTINE_CONTEXT();
  const nodeId = context.currentNodeId++;
  const targetNodeId = context.targetNodeId;

  // nodeId と targetNodeId を比較
  if (nodeId < targetNodeId) {
    // history から結果を取得
    return context.history.get(nodeId);
  }

  if (nodeId === targetNodeId) {
    // targetNodeResult を結果として返す
    const result: T = context.targetNodeResult;
    // 結果を history に保存して返す
    context.history.set(nodeId, result);
    return result;
  }

  // recipe を実行
  const createFunction = (nodeResult: T) =>
    context.createFunction(nodeId, nodeResult);
  const deleteFunction = () => context.deleteFunction(nodeId);

  const result = recipe(createFunction, deleteFunction);

  // disposer を登録
  context.disposers.set(nodeId, result.disposer);

  if (result.type === 'value') {
    // 結果を保存して返す
    context.history.set(nodeId, result.value);
    return result.value;
  } else if (result.type === 'empty') {
    throw QUON_EMPTY;
  }

  throw new Error('[Quon] INTERNAL ERROR: Unreachable (QUON_CREATE_NODE)');
}

type QUON_TASK =
  | {
      type: 'CREATE';
      nodeId: number;
      nodeResult: QUON_NODE_RESULT;
    }
  | {
      type: 'DELETE';
      nodeId: number;
    }
  | {
      type: 'CANCEL';
    }
  | {
      type: 'NOOP';
    };

const QUON_RUN_ROUTINE = (
  routine: () => void,
  context?: Record<symbol, any>
) => {
  // Cancel フラグ
  let cancelFrag = false;

  // 最後の DELETE の nodeId を記録（フィルタリング用）
  let lastDeleteNodeId = -1;

  // task Queue
  const taskQueue = new TaskQueue<QUON_TASK>();

  // 計算全体を解放する
  async function cancel() {
    await taskQueue.enqueue({ type: 'CANCEL' });
  }

  // 計算で使用するコンテキスト
  const quonContext: QUON_ROUTINE_CONTEXT = {
    currentNodeId: 0,
    history: new Map(),
    targetNodeId: -1,
    // create node result
    createFunction(nodeId: number, result: QUON_NODE_RESULT) {
      // lastDeleteNodeId より大きい nodeId は無効なので NOOP を積む
      if (nodeId > lastDeleteNodeId) {
        taskQueue.enqueue({ type: 'NOOP' });
      } else {
        taskQueue.enqueue({ type: 'CREATE', nodeId, nodeResult: result });
      }
    },
    // delete node result
    async deleteFunction(nodeId: number) {
      // lastDeleteNodeId を更新（より小さい値で）
      if (nodeId < lastDeleteNodeId) {
        lastDeleteNodeId = nodeId;
      }

      // lastDeleteNodeId より大きい nodeId は無効なので NOOP を積む
      if (nodeId > lastDeleteNodeId) {
        await taskQueue.enqueue({ type: 'NOOP' });
      } else {
        await taskQueue.enqueue({ type: 'DELETE', nodeId }); // このタスクが完了するまで待機
      }
    },
    disposers: new Map(),
    userContext: { ...context },
  };

  // fromId から toId までの解放関数を逆順で実行する
  // 両辺含む
  async function disposeFromTo(fromId: number, toId: number) {
    const disposers = quonContext.disposers;

    for (let id = toId; id >= fromId; id--) {
      const disposer = disposers.get(id);
      if (disposer) {
        await disposer();
        disposers.delete(id);
      }
    }
  }

  // routine を先に進める。throw されたら pend
  async function next() {
    const tempContext = QUON_GLOBAL_ROUTINE_CONTEXT;
    QUON_GLOBAL_ROUTINE_CONTEXT = quonContext;
    quonContext.currentNodeId = 0;

    try {
      routine();
    } catch (e) {
      if (e === QUON_EMPTY) {
        // pending
      }
    } finally {
      QUON_GLOBAL_ROUTINE_CONTEXT = tempContext;
      // 現在の targetId を更新
      quonContext.targetNodeId = quonContext.currentNodeId - 1;
      // next が終わったら lastDeleteNodeId を target で初期化
      lastDeleteNodeId = quonContext.targetNodeId;
    }
  }

  async function handleCreate(nodeId: number, nodeResult: QUON_NODE_RESULT) {
    // cancel 処理が要求されていたら無視する
    if (cancelFrag) return;
    // nodeId と 現在の targetNodeId が異なっていたなら無視する
    if (nodeId !== quonContext.targetNodeId) return;

    // 次のタスクをチェック: CREATE n v の直後に DELETE m (m < n) がある場合スキップ
    const remainingTasks = taskQueue.getRemainingTasks();
    if (remainingTasks.length > 0) {
      const nextTask = remainingTasks[0];
      if (
        nextTask &&
        nextTask.type === 'DELETE' &&
        'nodeId' in nextTask &&
        nextTask.nodeId < nodeId
      ) {
        // この CREATE をスキップ (next で進めてから DELETE で戻ってくるのと同じ)
        return;
      }
    }

    // node result をセットして next() を実行
    quonContext.targetNodeResult = nodeResult;
    await next();
  }

  async function handleDelete(nodeId: number) {
    // cancel 処理が要求されていたら無視する
    if (cancelFrag) return;
    // nodeId が targetNodeId 以上の場合 (処理が完了していない node を解放しようとしている場合) は無視する
    if (nodeId >= quonContext.targetNodeId) return;

    // キャンセル処理 (nodeId + 1 ～ targetNodeId を解放)
    await disposeFromTo(nodeId + 1, quonContext.targetNodeId);
    // targetNodeId をセット
    quonContext.targetNodeId = nodeId;
    quonContext.targetNodeResult = undefined;
    // next は呼ばない (pending するので)
  }

  async function handleCancel() {
    // cancel 処理
    cancelFrag = true;
    // 以降は CREATE / DELETE は無視される
    // 0 ～ targetNodeId を解放
    await disposeFromTo(0, quonContext.targetNodeId);
  }

  async function handleTask(task: QUON_TASK) {
    switch (task.type) {
      case 'CREATE':
        await handleCreate(task.nodeId, task.nodeResult);
        break;
      case 'DELETE':
        await handleDelete(task.nodeId);
        break;
      case 'CANCEL':
        await handleCancel();
        break;
      case 'NOOP':
        // NOOP タスクは何もせずに即座に完了
        break;
    }
  }

  // task queue を起動
  taskQueue.launch(handleTask);

  // 最初の next() を実行
  next();

  // cancel 関数を返す
  return {
    cancel,
  };
};

export const QUON_RUN_ROUTINE_INTERNAL = (routine: () => void) => {
  return QUON_CREATE_NODE<void>(() => {
    const currentContext = QUON_GET_CURRENT_ROUTINE_CONTEXT();
    const { cancel } = QUON_RUN_ROUTINE(routine, currentContext.userContext);
    return {
      type: 'value' as const,
      disposer: async () => {
        cancel();
      },
      value: undefined,
    };
  });
};

export const QUON_RUN_ROUTINE_EXTERNAL = (routine: () => void) => {
  return QUON_RUN_ROUTINE(routine);
};

export const QUON_ADD_ROUTINE_USER_CONTEXT = (symbol: symbol, value: any) => {
  const currentContext = QUON_GET_CURRENT_ROUTINE_CONTEXT();
  currentContext.userContext[symbol] = value;
};

export const QUON_DELETE_ROUTINE_USER_CONTEXT = (symbol: symbol) => {
  const currentContext = QUON_GET_CURRENT_ROUTINE_CONTEXT();
  delete currentContext.userContext[symbol];
};

export const QUON_GET_ROUTINE_USER_CONTEXT = (symbol: symbol) => {
  const currentContext = QUON_GET_CURRENT_ROUTINE_CONTEXT();
  return currentContext.userContext[symbol];
};
