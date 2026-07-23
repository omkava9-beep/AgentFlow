let ioInstance = null;

export function setIo(io) {
  ioInstance = io;
}

export function getIo() {
  if (!ioInstance) throw new Error('Socket.io not initialized yet');
  return ioInstance;
}
