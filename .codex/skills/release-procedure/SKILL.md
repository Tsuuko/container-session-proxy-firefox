---
name: release-procedure
description: 'Repository-specific release workflow for container-session-proxy-firefox. Use when preparing a release, bumping package.json version, committing the version update, creating a git tag, and pushing commits/tags to the remote. Also use for Japanese requests about リリース手順, バージョン更新, タグ付け, or push.'
---

# Release Procedure

## 概要

この skill は、このリポジトリのリリース作業を一貫して進めるために使う。
対象は `package.json` の version 更新、検証、コミット、タグ作成、remote への push まで。

## 事前確認

リリース作業を始める前に、次を確認する。

- 目的の version がユーザーから明示されているか確認する。未指定なら現在の `package.json` と既存 tag を見て、patch/minor/major のどれを上げるか確認する。
- `git status --short` で作業ツリーを確認する。リリースに無関係な変更がある場合は、勝手に含めない。
- `git branch --show-current` と `git remote -v` で push 先を確認する。
- 既存 tag と重複しないことを `git tag --list "v<version>"` で確認する。

## リリース手順

PowerShell では次の形を基本にする。

```powershell
$version = '0.1.1'
pnpm version $version --no-git-tag-version
pnpm run compile
pnpm run format:check
pnpm run build:firefox
git status --short
git add package.json
git commit -m "chore: bump version to $version"
git tag "v$version"
$branch = git branch --show-current
git push origin $branch
git push origin "v$version"
```

`pnpm version` や検証コマンドで `pnpm-lock.yaml` が変更された場合は、`git add package.json pnpm-lock.yaml` として同じコミットに含める。
release artifact が必要な場合は、commit 前の検証に `pnpm run zip:firefox` も追加する。

## 失敗時の扱い

検証コマンドが失敗したら、原因を修正してから同じ検証を再実行する。
commit、tag、push は検証が通るまで進めない。
tag 作成後に push 前で失敗した場合は、既存 tag の扱いをユーザーに確認してから続行する。

## 禁止事項

- `git tag -f` や `git push --force` は、ユーザーが明示的に求めない限り使わない。
- 未確認の作業ツリー変更を release commit に混ぜない。
- credentials、proxy URL、local profile などの秘密情報を commit しない。

## 完了報告

最後に、更新後の version、作成した commit、作成した tag、push 先 branch、実行した検証コマンドを簡潔に報告する。
