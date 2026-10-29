/**
 * The Built-in model: one fixed entry for now. Kept as data so a later list
 * (or a user's own file) can replace it without touching the download code.
 * Files are pinned to a repository commit; `sha256` and `size` come from it.
 */

export type ModelFile = { name: string; url: string; sha256: string; size: number };

export type ModelEntry = {
  id: string;
  name: string;
  /** Bump with an app update to offer the new model; the old one is deleted once it is replaced. */
  version: string;
  files: ModelFile[];
};

const QWEN35_4B_COMMIT = "e87f176479d0855a907a41277aca2f8ee7a09523";
const qwenUrl = (name: string) =>
  `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/${QWEN35_4B_COMMIT}/${name}`;

/** Qwen3.5 4B (Apache-2.0), 4-bit, with its vision projector for scans. */
export const BUILT_IN_MODEL: ModelEntry = {
  id: "qwen3.5-4b",
  name: "Qwen3.5 4B",
  version: "1",
  files: [
    {
      name: "Qwen3.5-4B-Q4_K_M.gguf",
      url: qwenUrl("Qwen3.5-4B-Q4_K_M.gguf"),
      sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
      size: 2740937888,
    },
    {
      name: "mmproj-F16.gguf",
      url: qwenUrl("mmproj-F16.gguf"),
      sha256: "cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864",
      size: 672423616,
    },
  ],
};

export function modelSize(entry: ModelEntry): number {
  return entry.files.reduce((sum, f) => sum + f.size, 0);
}
