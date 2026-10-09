// Not a schema: it uses the page API the way an application's renderer would, so that the
// type-check fails when `getPathForFile` is not declared with the types of the helper.
export function onDrop(event: DragEvent): Promise<boolean> {
   const file = event.dataTransfer?.files[0];
   if (!file) {
      return Promise.resolve(false);
   }
   const path: string = window.ipc.getPathForFile(file);
   return window.ipc.upload.invoke(path, file.name);
}
