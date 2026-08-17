import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { fcpRatings } from "@/db/schema";

export async function getFcpRating(playerId: number) {
  const [row] = await db.select().from(fcpRatings).where(eq(fcpRatings.playerId, playerId)).limit(1);
  return row ?? null;
}
