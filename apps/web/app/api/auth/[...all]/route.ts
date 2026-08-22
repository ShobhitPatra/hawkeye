import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/auth";

export const { GET, POST } = toNextJsHandler((request) => getAuth().handler(request));
