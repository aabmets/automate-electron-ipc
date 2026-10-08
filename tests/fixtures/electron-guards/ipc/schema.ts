import { defineChannels, invoke, send } from "automate-electron-ipc";
import { idArgs } from "./validators";

export default defineChannels({
   // Only the page at app://main may call these.
   secret: invoke<(id: number) => Promise<string>>({ allowedOrigins: ["app://main"] }),
   note: send<(text: string) => void>({ allowedOrigins: ["app://main"] }),
   // Open to every origin, but subject to the validateSender hook of configureIpc.
   open: invoke<(id: number) => Promise<string>>(),
   // The arguments are validated.
   checked: invoke<(id: number) => Promise<string>>({ validate: idArgs }),
   checkedSend: send<(id: number) => void>({ validate: idArgs }),
});
