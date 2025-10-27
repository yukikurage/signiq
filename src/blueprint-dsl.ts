import { Blueprint as BlueprintClass } from './blueprint';
import { Queue } from './queue';

type BlueprintResult = any;

/**
 * Blueprint チェインのための例外
 * $ 関数内で Blueprint が呼ばれたときに throw される
 */
class BlueprintChainException<U> {
  constructor(
    public readonly blueprint: BlueprintClass<U>,
    public readonly continuation: (value: U) => BlueprintClass<any>
  ) {}
}

type BLUEPRINT_DSL_GLOBAL_TYPE = {
  useFunc<T>(blueprint: BlueprintClass<T>): T;
};

let BLUEPRINT_DSL_GLOBAL: BLUEPRINT_DSL_GLOBAL_TYPE | undefined = undefined;

export namespace BlueprintDSL {
  export function use<T>(blueprint: BlueprintClass<T>): T {
    const global = BLUEPRINT_DSL_GLOBAL;
    if (global === undefined) {
      throw new Error('BlueprintDSL.use must be called within Blueprint.build');
    }
    const useFunc = global.useFunc;
    return useFunc(blueprint);
  }

  export function build<T>(program: () => T): BlueprintClass<T> {
    // Blueprint の発火履歴がある場合に、それらを発火したあとの continuation を作成する。
    function runProgramWithHistory(
      history: Queue<BlueprintResult>
    ): BlueprintClass<T> {
      let currentHistory = history;

      // Blueprint をチェインさせるための関数 $
      function useFunc<U>(bp: BlueprintClass<U>): U {
        const dequeued = Queue.dequeue(currentHistory);

        if (dequeued !== undefined) {
          // 履歴がある場合: 履歴の値を返し、残りの履歴で続行
          const { value, queue: remainingHistory } = dequeued;
          currentHistory = remainingHistory;
          return value as U;
        } else {
          // 履歴が枯渇した場合: 継続を作成して Blueprint に flatMap
          const continuation = (v: U): BlueprintClass<T> => {
            return runProgramWithHistory(Queue.enqueue(history, v));
          };

          // 例外を throw して外側で Blueprint を返す
          throw new BlueprintChainException(bp, continuation);
        }
      }

      // program を実行してみる
      const temp = BLUEPRINT_DSL_GLOBAL;
      BLUEPRINT_DSL_GLOBAL = { useFunc };
      try {
        const result = program();
        BLUEPRINT_DSL_GLOBAL = temp;
        // すべての履歴が消費され、結果が得られた場合
        return BlueprintClass.pure(result);
      } catch (e) {
        if (e instanceof BlueprintChainException) {
          // Blueprint チェインが発生した場合
          BLUEPRINT_DSL_GLOBAL = temp;
          return e.blueprint.flatMap(e.continuation as any);
        }
        // その他のエラーは再 throw
        throw e;
      }
    }

    // 空の履歴から開始
    return runProgramWithHistory(Queue.empty());
  }
}
