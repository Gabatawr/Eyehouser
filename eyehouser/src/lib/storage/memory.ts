export class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private tail = 0;
  private _size = 0;

  constructor(private maxSize = 10000) {
    this.buffer = new Array(maxSize);
  }

  push(item: T) {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.maxSize;
    if (this._size === this.maxSize) {
      this.tail = (this.tail + 1) % this.maxSize;
    } else {
      this._size++;
    }
  }

  getAll(): T[] {
    const res: T[] = [];
    for (let i = 0; i < this._size; i++) {
      res.push(this.buffer[(this.tail + i) % this.maxSize]);
    }
    return res;
  }

  clear() { this.head = 0; this.tail = 0; this._size = 0; }
  get size() { return this._size; }
}
