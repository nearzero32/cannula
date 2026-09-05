# Phase 8C transfer bundle

Base commit is recorded in `base-commit.txt`.

1. Clone the repository on Linux and check out that exact commit:
   ```sh
   git clone <repository-url> cannula
   cd cannula
   git checkout "$(cat /path/to/phase8c-transfer/base-commit.txt)"
   ```
2. Copy `phase8c-transfer/` into the repository root.
3. Apply all tracked working-tree changes:
   ```sh
   git apply --binary phase8c-transfer/tracked.patch
   ```
   The recorded changes were unstaged, so do not use `--index`.
4. Restore untracked files, preserving paths:
   ```sh
   rsync -a phase8c-transfer/untracked/ ./
   ```
   This bundle currently has no relevant untracked files; see `untracked-files.txt`.
5. Verify reproduction:
   ```sh
   git status --short
   git diff --check
   ```

The archive intentionally excludes credentials, `.env`, secrets, dependency directories, build output, logs, and Mongo data.
