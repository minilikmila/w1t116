interface QueuedOperation<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

class OperationQueue {
  private queue: QueuedOperation<any>[] = [];
  private processing = false;

  async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ execute: operation, resolve, reject });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const op = this.queue.shift()!;
    try {
      const result = await op.execute();
      op.resolve(result);
    } catch (err) {
      op.reject(err);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }
}

export const operationQueue = new OperationQueue();
export default operationQueue;
