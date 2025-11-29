// Convenience re-exports for frequently used functions (React-like design)
export * from './routine';
export * from './source';
export * from './blueprint';

import { Blueprint as B } from './blueprint';
export const use = B.use;
export const useEffect = B.useEffect;
export const useTimeout = B.useTimeout;
export const useAtom = B.useAtom;
export const usePortal = B.usePortal;
export const useConnection = B.useConnection;
export const useDerivation = B.useDerivation;
export const useAll = B.useAll;
export const useFork = B.useFork;
export const useJoin = B.useJoin;
export const toRoutine = B.toRoutine;
