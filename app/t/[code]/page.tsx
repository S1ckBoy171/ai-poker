import { Suspense } from "react";
import { FriendTable } from "./friend-table";

// The table reads its code from the URL, so it renders at request time inside a Suspense boundary.
export default function FriendTablePage() {
  return (
    <Suspense fallback={<main className="grid min-h-dvh place-items-center font-display text-2xl text-gold">Finding the table…</main>}>
      <FriendTable />
    </Suspense>
  );
}
