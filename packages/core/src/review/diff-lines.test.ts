import { describe, expect, it } from "vitest";
import { commentableLines } from "./diff-lines.js";

const diff = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
`;

describe("commentableLines", () => {
  it("collects right-side lines per file", () => {
    const lines = commentableLines(diff);
    expect([...lines.get("src/a.ts")!]).toEqual([1, 2, 3, 4]);
    expect([...lines.get("new.txt")!]).toEqual([1, 2]);
  });
  it("counts added content lines that begin with plus signs", () => {
    const diffWithPluses = `diff --git a/src/a.c b/src/a.c
index 1..2 100644
--- a/src/a.c
+++ b/src/a.c
@@ -1,2 +1,4 @@
 int a;
+++i;
+int b;
 int c;
`;
    expect([...commentableLines(diffWithPluses).get("src/a.c")!]).toEqual([1, 2, 3, 4]);
  });
  it("returns an empty map for an empty diff", () => {
    expect(commentableLines("").size).toBe(0);
  });
  it("ignores deleted files and does not pollute the previous file", () => {
    const diffWithDeleted = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 export { a, b };
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;
    const lines = commentableLines(diffWithDeleted);
    expect([...lines.get("src/a.ts")!]).toEqual([1, 2, 3, 4]);
    expect(lines.has("gone.ts")).toBe(false);
  });
});
