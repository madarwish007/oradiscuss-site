# Academy lessons: how to add one

This folder holds the LESSONS, one file per lesson, nested in a folder named
after the course:

```
src/content/academy/<course-slug>/<lesson-slug>.md
```

The course slug must match a file in `src/content/academy-courses/`. It is a
schema reference, so a lesson pointing at a course that does not exist fails the
build rather than rendering a link to nowhere.

This folder is empty on purpose. Which module is written first is a founder
decision and it has not been taken. Files whose name starts with an underscore
are not loaded as content, which is why this file can sit here without becoming
a lesson, and it keeps the folder in git.

The schema lives in `src/content.config.ts` under `academy`.

```yaml
---
course: the-course-slug
module: The module name, exactly as spelled in that course's `modules` list
order: 1
title: The lesson title
summary: One sentence. What this lesson does.
estimatedMinutes: 45
prerequisites:
  - Finished the previous lesson
oracleVersions:
  - 19c
lastReviewed: 2026-08-08
draft: false
---
```

Notes that are easy to get wrong:

- `order` is the position within the MODULE, not within the course. It is
  explicit because file names sort alphabetically and lesson 10 would otherwise
  land between lesson 1 and lesson 2.
- `estimatedMinutes` is working time at a terminal, not reading time. Reading
  time can be computed from the body. The time a lab actually takes cannot.
- `oracleVersions` is per lesson as well as per course, because one lesson in a
  19c course can be 23ai only and the reader needs to know that before starting.
- `lastReviewed` is required, for the same reason it is required on a course.
- No price field, ever. See the course notes for why.

Before writing any Oracle technical content, read the Oracle IP rules in
BUILD_PLAN section 4: research first, never write Oracle technical content from
model memory, and never ship a script taken from My Oracle Support.
