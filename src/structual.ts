type Structural =
  | string
  | number
  | boolean
  | null
  | undefined
  | Structural[]
  | { [key: string]: Structural };

export { Structural };
