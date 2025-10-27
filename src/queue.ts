import { LinkedList } from './linked-list.js';

/**
 * 永続的な関数型キュー (Banker's Queue)
 *
 * 2つのリストを使用して、以下の操作を償却 O(1) で実現:
 * - enqueue: 末尾に要素を追加
 * - dequeue: 先頭から要素を取り出し
 *
 * すべての操作は新しいキューを返し、元のキューは変更されない
 */
export interface Queue<T> {
  readonly front: LinkedList<T>;
  readonly rear: LinkedList<T>;
}

export namespace Queue {
  /**
   * 空のキューを作成
   * O(1)
   */
  export function empty<T>(): Queue<T> {
    return {
      front: LinkedList.nil,
      rear: LinkedList.nil,
    };
  }

  /**
   * キューが空かどうかを判定
   * O(1)
   */
  export function isEmpty<T>(queue: Queue<T>): boolean {
    return LinkedList.isEmpty(queue.front) && LinkedList.isEmpty(queue.rear);
  }

  /**
   * front が空の場合に rear を反転して front に移動
   * O(n) ただし償却 O(1)
   */
  function check<T>(queue: Queue<T>): Queue<T> {
    if (LinkedList.isEmpty(queue.front)) {
      return {
        front: LinkedList.reverse(queue.rear),
        rear: LinkedList.nil,
      };
    }
    return queue;
  }

  /**
   * キューの末尾に要素を追加
   * O(1)
   */
  export function enqueue<T>(queue: Queue<T>, value: T): Queue<T> {
    return check({
      front: queue.front,
      rear: LinkedList.cons(value, queue.rear),
    });
  }

  /**
   * キューの先頭要素を取得（キューは変更されない）
   * O(1)
   */
  export function peek<T>(queue: Queue<T>): T | undefined {
    const checked = check(queue);
    return LinkedList.head(checked.front);
  }

  /**
   * キューの先頭要素を取り出し、残りのキューを返す
   * O(1) (償却)
   *
   * @returns { value, queue } - value: 取り出した要素, queue: 残りのキュー
   *          キューが空の場合は undefined を返す
   */
  export function dequeue<T>(
    queue: Queue<T>
  ): { value: T; queue: Queue<T> } | undefined {
    const checked = check(queue);

    // キューが空かどうかを判定
    if (LinkedList.isEmpty(checked.front)) {
      return undefined;
    }

    const value = LinkedList.head(checked.front)!;

    return {
      value,
      queue: check({
        front: LinkedList.tail(checked.front),
        rear: checked.rear,
      }),
    };
  }

  /**
   * 配列からキューを作成
   * O(n)
   */
  export function fromArray<T>(arr: readonly T[]): Queue<T> {
    return {
      front: LinkedList.fromArray(arr),
      rear: LinkedList.nil,
    };
  }

  /**
   * キューを配列に変換
   * O(n)
   */
  export function toArray<T>(queue: Queue<T>): T[] {
    const frontArray = LinkedList.toArray(queue.front);
    const rearArray = LinkedList.toArray(LinkedList.reverse(queue.rear));
    return [...frontArray, ...rearArray];
  }

  /**
   * キューの長さを取得
   * O(n)
   */
  export function length<T>(queue: Queue<T>): number {
    return LinkedList.length(queue.front) + LinkedList.length(queue.rear);
  }

  /**
   * キューの各要素に関数を適用
   * O(n)
   */
  export function map<T, U>(queue: Queue<T>, f: (value: T) => U): Queue<U> {
    return {
      front: LinkedList.map(queue.front, f),
      rear: LinkedList.map(queue.rear, f),
    };
  }

  /**
   * キューの各要素に対して副作用を実行（先頭から末尾の順）
   * O(n)
   */
  export function forEach<T>(queue: Queue<T>, f: (value: T) => void): void {
    LinkedList.forEach(queue.front, f);
    LinkedList.forEach(LinkedList.reverse(queue.rear), f);
  }

  /**
   * 条件を満たす要素のみを含む新しいキューを作成
   * O(n)
   */
  export function filter<T>(
    queue: Queue<T>,
    predicate: (value: T) => boolean
  ): Queue<T> {
    return check({
      front: LinkedList.filter(queue.front, predicate),
      rear: LinkedList.filter(queue.rear, predicate),
    });
  }

  /**
   * 2つのキューを連結
   * O(n) where n is the total length
   */
  export function append<T>(queue1: Queue<T>, queue2: Queue<T>): Queue<T> {
    const arr1 = toArray(queue1);
    const arr2 = toArray(queue2);
    return fromArray([...arr1, ...arr2]);
  }

  /**
   * キューをイテレータとして使用（先頭から末尾の順）
   */
  export function* iterator<T>(queue: Queue<T>): Generator<T> {
    yield* LinkedList.iterator(queue.front);
    yield* LinkedList.iterator(LinkedList.reverse(queue.rear));
  }

  /**
   * 左畳み込み（先頭から末尾の順）
   * O(n)
   */
  export function foldLeft<T, U>(
    queue: Queue<T>,
    initial: U,
    f: (acc: U, value: T) => U
  ): U {
    const afterFront = LinkedList.foldLeft(queue.front, initial, f);
    return LinkedList.foldLeft(LinkedList.reverse(queue.rear), afterFront, f);
  }

  /**
   * 複数の要素を末尾に一度に追加
   * O(n) where n is the number of elements to enqueue
   */
  export function enqueueAll<T>(queue: Queue<T>, values: readonly T[]): Queue<T> {
    let result = queue;
    for (const value of values) {
      result = enqueue(result, value);
    }
    return result;
  }
}
