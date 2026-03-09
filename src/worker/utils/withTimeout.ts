export async function withTimeout<T>(
  promise: Promise<T>,
  ms = 8000,
  label = 'operation'
): Promise<T> {
  let timeoutId: any;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[TIMEOUT] ${label} > ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}
