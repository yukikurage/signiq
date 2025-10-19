// Test utilities for capturing logs and comparing outputs

export type LogEntry = string | { type: 'log'; message: string };

export class LogCapture {
  private logs: string[] = [];

  log(message: string): void {
    this.logs.push(message);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }

  // Compare logs with expected values (allows partial matching)
  expect(expected: string[]): { passed: boolean; message: string } {
    const actual = this.logs;

    if (actual.length !== expected.length) {
      return {
        passed: false,
        message: `Expected ${expected.length} logs, got ${actual.length}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`,
      };
    }

    for (let i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) {
        return {
          passed: false,
          message: `Log mismatch at index ${i}\nExpected: "${expected[i]}"\nActual: "${actual[i]}"`,
        };
      }
    }

    return {
      passed: true,
      message: 'All logs match expected values',
    };
  }

  // Expect logs to contain certain patterns
  expectContains(patterns: string[]): { passed: boolean; message: string } {
    const actual = this.logs;
    const missing: string[] = [];

    for (const pattern of patterns) {
      if (!actual.some(log => log.includes(pattern))) {
        missing.push(pattern);
      }
    }

    if (missing.length > 0) {
      return {
        passed: false,
        message: `Missing expected patterns: ${JSON.stringify(missing)}\nActual logs: ${JSON.stringify(actual)}`,
      };
    }

    return {
      passed: true,
      message: 'All expected patterns found',
    };
  }
}
