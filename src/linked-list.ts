/**
 * 永続化された単方向リンクリスト
 * すべての操作は新しいリストを返し、元のリストは変更されない
 */

export type LinkedList<T> = Nil | Cons<T>;

interface Nil {
  readonly type: 'nil';
}

interface Cons<T> {
  readonly type: 'cons';
  readonly head: T;
  readonly tail: LinkedList<T>;
}

export namespace LinkedList {
  /**
   * 空のリストを表す定数
   */
  export const nil: Nil = { type: 'nil' };

  /**
   * 新しい要素をリストの先頭に追加
   * O(1)
   */
  export function cons<T>(head: T, tail: LinkedList<T>): Cons<T> {
    return { type: 'cons', head, tail };
  }

  /**
   * リストが空かどうかを判定
   * O(1)
   */
  export function isEmpty<T>(list: LinkedList<T>): list is Nil {
    return list.type === 'nil';
  }

  /**
   * リストの先頭要素を取得
   * O(1)
   */
  export function head<T>(list: LinkedList<T>): T | undefined {
    return list.type === 'cons' ? list.head : undefined;
  }

  /**
   * リストの先頭以外を取得
   * O(1)
   */
  export function tail<T>(list: LinkedList<T>): LinkedList<T> {
    return list.type === 'cons' ? list.tail : nil;
  }

  /**
   * 配列からリストを作成
   * O(n)
   */
  export function fromArray<T>(arr: readonly T[]): LinkedList<T> {
    let result: LinkedList<T> = nil;
    for (let i = arr.length - 1; i >= 0; i--) {
      result = cons(arr[i]!, result);
    }
    return result;
  }

  /**
   * リストを配列に変換
   * O(n)
   */
  export function toArray<T>(list: LinkedList<T>): T[] {
    const result: T[] = [];
    let current = list;
    while (current.type === 'cons') {
      result.push(current.head);
      current = current.tail;
    }
    return result;
  }

  /**
   * リストの長さを取得
   * O(n)
   */
  export function length<T>(list: LinkedList<T>): number {
    let count = 0;
    let current = list;
    while (current.type === 'cons') {
      count++;
      current = current.tail;
    }
    return count;
  }

  /**
   * リストの各要素に関数を適用
   * O(n)
   */
  export function map<T, U>(
    list: LinkedList<T>,
    f: (value: T) => U
  ): LinkedList<U> {
    if (list.type === 'nil') {
      return nil;
    }
    return cons(f(list.head), map(list.tail, f));
  }

  /**
   * リストの各要素に対して副作用を実行
   * O(n)
   */
  export function forEach<T>(list: LinkedList<T>, f: (value: T) => void): void {
    let current = list;
    while (current.type === 'cons') {
      f(current.head);
      current = current.tail;
    }
  }

  /**
   * 条件を満たす要素のみを含む新しいリストを作成
   * O(n)
   */
  export function filter<T>(
    list: LinkedList<T>,
    predicate: (value: T) => boolean
  ): LinkedList<T> {
    if (list.type === 'nil') {
      return nil;
    }
    const filteredTail = filter(list.tail, predicate);
    return predicate(list.head) ? cons(list.head, filteredTail) : filteredTail;
  }

  /**
   * 2つのリストを連結
   * O(n) where n is the length of the first list
   */
  export function append<T>(
    list1: LinkedList<T>,
    list2: LinkedList<T>
  ): LinkedList<T> {
    if (list1.type === 'nil') {
      return list2;
    }
    return cons(list1.head, append(list1.tail, list2));
  }

  /**
   * リストを逆順にする
   * O(n)
   */
  export function reverse<T>(list: LinkedList<T>): LinkedList<T> {
    let result: LinkedList<T> = nil;
    let current = list;
    while (current.type === 'cons') {
      result = cons(current.head, result);
      current = current.tail;
    }
    return result;
  }

  /**
   * リストの先頭n個の要素を取得
   * O(n)
   */
  export function take<T>(list: LinkedList<T>, n: number): LinkedList<T> {
    if (n <= 0 || list.type === 'nil') {
      return nil;
    }
    return cons(list.head, take(list.tail, n - 1));
  }

  /**
   * リストの先頭n個の要素をスキップ
   * O(n)
   */
  export function drop<T>(list: LinkedList<T>, n: number): LinkedList<T> {
    let current = list;
    let count = n;
    while (count > 0 && current.type === 'cons') {
      current = current.tail;
      count--;
    }
    return current;
  }

  /**
   * 左畳み込み
   * O(n)
   */
  export function foldLeft<T, U>(
    list: LinkedList<T>,
    initial: U,
    f: (acc: U, value: T) => U
  ): U {
    let result = initial;
    let current = list;
    while (current.type === 'cons') {
      result = f(result, current.head);
      current = current.tail;
    }
    return result;
  }

  /**
   * 右畳み込み
   * O(n)
   */
  export function foldRight<T, U>(
    list: LinkedList<T>,
    initial: U,
    f: (value: T, acc: U) => U
  ): U {
    if (list.type === 'nil') {
      return initial;
    }
    return f(list.head, foldRight(list.tail, initial, f));
  }

  /**
   * 指定されたインデックスの要素を取得
   * O(n)
   */
  export function get<T>(list: LinkedList<T>, index: number): T | undefined {
    let current = list;
    let i = 0;
    while (current.type === 'cons') {
      if (i === index) {
        return current.head;
      }
      current = current.tail;
      i++;
    }
    return undefined;
  }

  /**
   * リストをイテレータとして使用
   */
  export function* iterator<T>(list: LinkedList<T>): Generator<T> {
    let current = list;
    while (current.type === 'cons') {
      yield current.head;
      current = current.tail;
    }
  }
}
