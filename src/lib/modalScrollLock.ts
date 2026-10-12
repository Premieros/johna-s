// Shared ownership prevents nested dialogs from restoring a stale scroll lock.
const owners: symbol[] = [];
let previousOverflow = '';

export function acquireModalScrollLock() {
  const owner = Symbol('modal');
  if (owners.length === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  owners.push(owner);
  let released = false;
  return {
    isTop: () => owners[owners.length - 1] === owner,
    release: () => {
      if (released) return;
      released = true;
      const index = owners.indexOf(owner);
      if (index !== -1) owners.splice(index, 1);
      if (owners.length === 0) document.body.style.overflow = previousOverflow;
    },
  };
}
