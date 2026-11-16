import "fake-indexeddb/auto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  blobToDataUrl,
  dataUrlToBlob,
  deletePhoto,
  getPhoto,
  isInlinePhoto,
  migrateInlinePhotos,
  putPhoto,
} from "../../lib/photo-store.js";

// Node has Blob and atob but no FileReader; a tiny stand-in keeps these tests in
// the Node environment, where Blobs survive fake-indexeddb's structured clone.
beforeAll(() => {
  if (typeof globalThis.FileReader !== "undefined") return;
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buffer) => {
          this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
          this.onload?.();
        })
        .catch((err) => {
          this.error = err;
          this.onerror?.();
        });
    }
  };
});

// 1x1 transparent PNG
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const createdIds = new Set();
afterEach(async () => {
  for (const id of createdIds) await deletePhoto(id);
  createdIds.clear();
});

async function bytesOf(blob) {
  return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("isInlinePhoto", () => {
  it("recognises data URLs only", () => {
    expect(isInlinePhoto(PNG_DATA_URL)).toBe(true);
    expect(isInlinePhoto("data:text/plain,hi")).toBe(true);
    expect(isInlinePhoto("blob:https://example.test/123")).toBe(false);
    expect(isInlinePhoto("https://example.test/photo.png")).toBe(false);
    expect(isInlinePhoto("")).toBe(false);
    expect(isInlinePhoto(null)).toBe(false);
    expect(isInlinePhoto(undefined)).toBe(false);
    expect(isInlinePhoto({})).toBe(false);
  });
});

describe("dataUrlToBlob / blobToDataUrl", () => {
  it("decodes a base64 data URL with its MIME type", async () => {
    const blob = dataUrlToBlob(PNG_DATA_URL);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
    const bytes = await bytesOf(blob);
    expect(bytes.slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]); // \x89PNG
  });

  it("decodes a percent-encoded (non-base64) data URL", async () => {
    const blob = dataUrlToBlob("data:text/plain,hello%20world");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("hello world");
  });

  it("defaults the type when the header has none", () => {
    expect(dataUrlToBlob("data:;base64,aGk=").type).toBe("application/octet-stream");
  });

  it("rejects values that are not data URLs", () => {
    expect(() => dataUrlToBlob("https://example.test/a.png")).toThrow(/Not a data URL/);
    expect(() => dataUrlToBlob("data:image/png;base64")).toThrow(/Malformed/);
  });

  it("round-trips through blobToDataUrl", async () => {
    const blob = dataUrlToBlob(PNG_DATA_URL);
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toBe(PNG_DATA_URL);
    expect(await bytesOf(dataUrlToBlob(dataUrl))).toEqual(await bytesOf(blob));
  });
});

describe("IndexedDB photo storage", () => {
  it("puts, gets and deletes a photo by entry id", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/webp" });
    createdIds.add("entry-1");
    await expect(putPhoto("entry-1", blob)).resolves.toBe("entry-1");

    const stored = await getPhoto("entry-1");
    expect(stored).toBeInstanceOf(Blob);
    expect(stored.type).toBe("image/webp");
    expect(await bytesOf(stored)).toEqual([1, 2, 3, 4]);

    await deletePhoto("entry-1");
    expect(await getPhoto("entry-1")).toBeNull();
  });

  it("overwrites an existing photo for the same entry", async () => {
    createdIds.add("entry-2");
    await putPhoto("entry-2", new Blob(["old"], { type: "text/plain" }));
    await putPhoto("entry-2", new Blob(["new!"], { type: "text/plain" }));
    expect(await (await getPhoto("entry-2")).text()).toBe("new!");
  });

  it("returns null for unknown or empty ids", async () => {
    expect(await getPhoto("missing")).toBeNull();
    expect(await getPhoto("")).toBeNull();
    await expect(deletePhoto("")).resolves.toBeUndefined();
  });

  it("refuses to store without an id or a blob", async () => {
    await expect(putPhoto("", new Blob(["x"]))).rejects.toThrow(/required/);
    await expect(putPhoto("entry-3", "not a blob")).rejects.toThrow(/required/);
  });
});

describe("migrateInlinePhotos", () => {
  it("moves inline photos into IndexedDB and reports only verified ids", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const entries = [
      { id: "m-ok", photoDataUrl: PNG_DATA_URL },
      { id: "m-none" },
      { id: "m-remote", photoDataUrl: "https://example.test/a.png" },
      { id: "m-broken", photoDataUrl: "data:image/png;base64" }, // malformed: decoding throws
    ];
    entries.forEach((entry) => createdIds.add(entry.id));
    const before = structuredClone(entries);

    const migrated = await migrateInlinePhotos(entries);

    expect(migrated).toEqual(["m-ok"]);
    expect(await bytesOf(await getPhoto("m-ok"))).toEqual(await bytesOf(dataUrlToBlob(PNG_DATA_URL)));
    expect(await getPhoto("m-broken")).toBeNull();
    // migrateInlinePhotos never strips data itself; callers strip only the returned ids
    expect(entries).toEqual(before);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("reports nothing as migrated when the photo database is unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const savedIndexedDb = globalThis.indexedDB;
    try {
      delete globalThis.indexedDB;
      const fresh = await import("../../lib/photo-store.js");
      const entries = [{ id: "n-1", photoDataUrl: PNG_DATA_URL }];
      expect(await fresh.migrateInlinePhotos(entries)).toEqual([]);
      expect(entries[0].photoDataUrl).toBe(PNG_DATA_URL);
      expect(console.error).toHaveBeenCalled();
    } finally {
      globalThis.indexedDB = savedIndexedDb;
    }
  });

  it("does not report an id whose stored photo fails verification", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Simulate a write that silently stores something different: the stored
    // record carries a truncated blob, so the size check must reject it.
    const realPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (value, key) {
      const tampered = { ...value, blob: new Blob(["x"], { type: value.type }) };
      return realPut.call(this, tampered, key);
    });
    createdIds.add("v-1");

    try {
      expect(await migrateInlinePhotos([{ id: "v-1", photoDataUrl: PNG_DATA_URL }])).toEqual([]);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("v-1"), expect.any(Error));
    } finally {
      putSpy.mockRestore();
    }
  });
});
