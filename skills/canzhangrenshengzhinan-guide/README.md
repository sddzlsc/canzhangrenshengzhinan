# 让 AI 照着《残障人生指南》回答（skill 装法）

这是一个给 AI 助手用的 skill：装上之后，直接问「残疾人证能领什么」「工伤认定期限过了怎么办」「二级残疾能不能申请护理补贴」，它会先从《残障人生指南》的正文里把相关条目查出来，再按书里的方式回答，每条注明出自第几节第几条；书里没有的就直说没有，不自己编数字。

## 装到 Codex

```bash
mkdir -p ~/.codex/skills
git clone --depth 1 https://github.com/sddzlsc/canzhangrenshengzhinan.git "${TMPDIR:-/tmp}/czrszn"
cp -R "${TMPDIR:-/tmp}/czrszn/skills/canzhangrenshengzhinan-guide" ~/.codex/skills/
```

装完新开一个会话，直接提问即可。

## 装到 Claude Code

```bash
mkdir -p ~/.claude/skills
git clone --depth 1 https://github.com/sddzlsc/canzhangrenshengzhinan.git "${TMPDIR:-/tmp}/czrszn"
cp -R "${TMPDIR:-/tmp}/czrszn/skills/canzhangrenshengzhinan-guide" ~/.claude/skills/
```

## 不装 skill 直接问行不行

行。把这句话发给任何 AI 助手：

> 先克隆 https://github.com/sddzlsc/canzhangrenshengzhinan （`git clone --depth 1`），读 book/ 下 10 个文件的正文，再回答我的问题：每条结论都要注明出自第几节第几条，书里没有就说没有，不要用你自己的记忆补数字和法条。

## 它不会做什么

- 不替医生做诊断、不替律师做诉讼策略：涉及诊断、用药、打官司，它给书里的口径，并建议找医生和律师。
- 不承诺办得成：政策标准和办理材料各省不同，它会给官方入口，让你去当地再核一遍。
- 不编数字：书里没有的数字、法条和条目，它不会说。
