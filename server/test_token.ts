import { Dropbox } from "dropbox";
import "dotenv/config";

const ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN || "";

async function test() {
  const dbx = new Dropbox({ accessToken: ACCESS_TOKEN });
  try {
    const response = await dbx.usersGetCurrentAccount();
    console.log("Success! Connected as:", response.result.name.display_name);
  } catch (error) {
    console.error("Token failed:", error);
  }
}

test();
