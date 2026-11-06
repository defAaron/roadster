# Grading the first 30 reels

This sheet is empty until a person grades reels by hand. Fill one row per reel. Stop at 30 graded rows. This problem does not generate reels.

## Pass bar

A reel passes when it meets the Success bar in `docs/prd.md`:

A reel is successful when a person who knows the car can name it from the still, and each video reads as the named maneuver without a caption:

- Kickflip: one visible full rotation and a landing on the wheels.
- Flyover: the car’s body clearly passes above other cars and comes down.

In the table, that is: the car the grader expected is the car a person who knows it can name from the still; kickflip is one full rotation and a landing is yes only when the clip shows one visible full rotation and a landing on the wheels; flyover body clears the other cars and comes down is yes only when the body clearly passes above other cars and comes down.

## Checklist

| date | reel id | source (upload or catalog) | car the grader expected | kickflip still recognizable (yes/no) | kickflip is one full rotation and a landing (yes/no) | flyover still recognizable (yes/no) | flyover body clears the other cars and comes down (yes/no) | people or readable plates (yes/no) | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |  |  |

Use `yes` or `no` in the yes/no columns. Source is `upload` or `catalog`. Leave the row blank until that reel has been watched.

## If a reel fails the bar

The only code knobs are `MAGIC_HOUR_IMAGE_MODEL`, `MAGIC_HOUR_VIDEO_MODEL`, and the strings in `lib/scenes.ts` (`SHARED`, the kickflip and flyover still lines, and the kickflip and flyover motion lines). `wan-2.2` must keep omitting `end_image_file_path`.

Reel creation has no daily cap to raise. Do not add one from this sheet, and do not change rate limits in code to finish grading.
