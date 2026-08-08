# Academy courses: how to add one

This folder holds one file per COURSE. It is empty on purpose. Which course is
written first is a founder decision and it has not been taken, so nothing here
guesses at it.

Files whose name starts with an underscore are not loaded as content, which is
why this file can sit here without becoming a course. It also keeps the folder
in git, since git does not track empty directories.

The schema lives in `src/content.config.ts` under `academyCourses`. Every field
below is required unless it says otherwise.

```yaml
---
title: The full course title
summary: One or two sentences. What the reader can do afterwards that they could not do before.
modules:
  - The first module name
  - The second module name
oracleVersions:
  - 19c
  - 23ai
prerequisites:
  - A running database you are allowed to break
lastReviewed: 2026-08-08
draft: false
---
```

The body of this file is the course overview. It renders on `/academy/<slug>/`
above the module list.

Notes that are easy to get wrong:

- `modules` declares the teaching ORDER of the whole course. A lesson names its
  module with one of these exact strings. Declaring the order here means a
  half written course still renders its modules in the right sequence.
- `lastReviewed` is required. A lab manual for a product that keeps moving is
  only worth trusting if it says when it was last checked against a release.
- There is no price field and there must never be one. Academy access is
  included with the membership, flat and all access; per course pricing was
  proposed and rejected (spec section 2.1). Prices are read from the catalog
  database, never written into content.
- The file name is the course slug and therefore the URL. Renaming it changes a
  public URL, so pick it once.

Before writing any Oracle technical content, read the Oracle IP rules in
BUILD_PLAN section 4: research first, never write Oracle technical content from
model memory, and never ship a script taken from My Oracle Support.
