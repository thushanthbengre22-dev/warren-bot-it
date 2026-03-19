import { EventEmitter } from 'events';

const updateEmitter = new EventEmitter();

export function emitUpdate(): void {
  updateEmitter.emit('update');
}

export function onUpdate(cb: () => void): () => void {
  updateEmitter.on('update', cb);
  return () => updateEmitter.off('update', cb);
}