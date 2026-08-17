import { defineConfig } from "drizzle-kit";

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./data/fanta.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: DATABASE_PATH,
  },
});
