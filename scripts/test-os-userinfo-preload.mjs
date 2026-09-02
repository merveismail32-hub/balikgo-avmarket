import os from "node:os";

os.userInfo = () => ({ username: "qa", homedir: process.cwd(), shell: null, uid: -1, gid: -1 });
