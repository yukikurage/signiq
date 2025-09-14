import { Slot, slot$ } from './operation';
import { Routine } from './routine';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type Widen<T> = [T] extends [string]
  ? string
  : [T] extends [number]
    ? number
    : [T] extends [boolean]
      ? boolean
      : [T] extends [bigint]
        ? bigint
        : [T] extends [symbol]
          ? symbol
          : [T] extends [null]
            ? null
            : [T] extends [undefined]
              ? undefined
              : T;

type IsTuple<T extends readonly unknown[]> = number extends T['length']
  ? false
  : true;

type DeepSlotify<T> = [T] extends [(...args: any[]) => any]
  ? T
  : [T] extends [readonly (infer U)[]]
    ? Slot<ReadonlyArray<DeepSlotify<U>>>
    : [T] extends [Primitive]
      ? Slot<Widen<T>>
      : [T] extends [object]
        ? { [K in keyof T]: DeepSlotify<T[K]> }
        : Slot<Widen<T>>;

export async function* deepSlot$<T>(initialValue: T): Routine<DeepSlotify<T>> {
  if (Array.isArray(initialValue)) {
    const initialSlots = [];
    for (const item of initialValue) {
      if (typeof item === 'object' && item !== null) {
        initialSlots.push(yield* deepSlot$(item));
      } else {
        initialSlots.push(yield* slot$(item));
      }
    }
    return (yield* slot$(initialSlots)) as DeepSlotify<T>;
  } else if (typeof initialValue === 'object' && initialValue !== null) {
    const result: any = {};
    for (const key in initialValue) {
      const value = (initialValue as any)[key];
      if (typeof value === 'object' && value !== null) {
        result[key] = yield* deepSlot$(value);
      } else {
        result[key] = yield* slot$(value);
      }
    }
    return result as DeepSlotify<T>;
  } else {
    const simpleSlot = yield* slot$(initialValue);
    return simpleSlot as DeepSlotify<T>;
  }
}

type ShallowSlotify<T> = [T] extends [(...args: any[]) => any]
  ? T
  : [T] extends [readonly (infer U)[]]
    ? Slot<ReadonlyArray<Widen<U>>>
    : [T] extends [Primitive]
      ? Slot<Widen<T>>
      : [T] extends [object]
        ? { [K in keyof T]: Slot<Widen<T[K]>> }
        : Slot<Widen<T>>;

export async function* shallowSlot$<T>(
  initialValue: T
): Routine<ShallowSlotify<T>> {
  if (Array.isArray(initialValue)) {
    const slots = initialValue.map(item => slot$(item));
    const resolvedSlots = [];
    for (const s of slots) {
      resolvedSlots.push(yield* s);
    }
    return (yield* slot$(resolvedSlots)) as ShallowSlotify<T>;
  } else if (typeof initialValue === 'object' && initialValue !== null) {
    const result: any = {};
    for (const key in initialValue) {
      const value = (initialValue as any)[key];
      result[key] = yield* slot$(value);
    }
    return result as ShallowSlotify<T>;
  } else {
    const simpleSlot = yield* slot$(initialValue);
    return simpleSlot as ShallowSlotify<T>;
  }
}
