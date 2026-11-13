import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

/**
 * Server-side view of awareness (presence) states.
 *
 * Wire format of an awareness update (y-protocols/awareness):
 *   varUint count, then per client: varUint clientId, varUint clock, varString JSON state.
 *   A state of "null" means the client left.
 *
 * The server does not use the Awareness class from y-protocols: it runs an
 * interval timer, which would keep the Durable Object from hibernating. The
 * server only needs the latest state per client, to relay updates and to
 * announce removals when a socket closes. It never interprets the states;
 * each client sanitizes what it renders.
 */

interface Entry {
  clock: number;
  state: string;
}

export interface AwarenessChange {
  /** Clients whose state is now set. */
  present: number[];
  /** Clients whose state is now removed. */
  removed: number[];
}

export class AwarenessRegistry {
  private readonly entries = new Map<number, Entry>();

  get size(): number {
    return this.entries.size;
  }

  /** Apply an update. Throws on malformed input without changing anything. */
  apply(update: Uint8Array): AwarenessChange {
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    const parsed: Array<{ clientId: number; clock: number; state: string }> = [];
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarString(decoder);
      JSON.parse(state); // must be JSON
      parsed.push({ clientId, clock, state });
    }
    if (decoding.hasContent(decoder)) throw new Error("Trailing bytes in awareness update");

    const change: AwarenessChange = { present: [], removed: [] };
    for (const { clientId, clock, state } of parsed) {
      const current = this.entries.get(clientId);
      // Same rule as y-protocols: a newer clock wins; an equal clock may remove.
      const newer = current === undefined || current.clock < clock;
      const removalAtSameClock = current !== undefined && current.clock === clock && state === "null";
      if (!newer && !removalAtSameClock) continue;
      if (state === "null") {
        if (this.entries.delete(clientId)) change.removed.push(clientId);
      } else {
        this.entries.set(clientId, { clock, state });
        change.present.push(clientId);
      }
    }
    return change;
  }

  /** Every known state, for a client that just connected. Null when empty. */
  encodeAll(): Uint8Array | null {
    if (this.entries.size === 0) return null;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, this.entries.size);
    for (const [clientId, { clock, state }] of this.entries) {
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, state);
    }
    return encoding.toUint8Array(encoder);
  }

  /** Remove clients whose socket closed and encode the removal for the others. */
  remove(clientIds: readonly number[]): Uint8Array | null {
    const known = clientIds.filter((id) => this.entries.has(id));
    if (known.length === 0) return null;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, known.length);
    for (const clientId of known) {
      const entry = this.entries.get(clientId)!;
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, entry.clock + 1);
      encoding.writeVarString(encoder, "null");
      this.entries.delete(clientId);
    }
    return encoding.toUint8Array(encoder);
  }
}
