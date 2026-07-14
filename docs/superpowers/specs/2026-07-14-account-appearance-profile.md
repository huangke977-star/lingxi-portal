# HLOVET Account Appearance And Profile Design

## Goals

- Save theme, transparency, glass blur, glass tint, glass tint opacity, and avatar settings to the account.
- Restore a user's appearance settings after signing in on another device.
- Remove the redundant account facts table from the profile page and place role information inside the account card.
- Use an icon for the top navigation role indicator, with hover text showing only the role name.

## Appearance Settings

- Recommended themes and custom colors are mutually exclusive.
- Card transparency, glass blur, glass tint, and glass tint opacity are saved at the same level as the theme.
- Glass blur can be `0`, which sets background blur to `0px`.
- Glass tint opacity controls the strength of the background wash and can be `0`.
- Custom colors include accent, card surface, primary text, and secondary text.

## Avatar

- Signed-in users can upload their own avatar.
- JPEG, PNG, and WebP are accepted.
- Each avatar image can be up to 2 MB.
- Avatar files are stored in the `avatar_uploads` Docker named volume.
- Replacing an avatar removes the previous avatar file from disk.

## Level Explanation

- The profile page lists Qi Refining, Foundation Building, Golden Core, Nascent Soul, Spirit Transformation, Void Refining, Body Integration, and Mahayana.
- Administrator and super administrator are not shown in the level explanation list.
- Qi Refining is marked as acquired automatically on login.
- Other levels are marked as not open yet and do not include acquisition instructions.
