// scored.csv 에서 기준선 이상 공고 중 점수 높은 순으로 「보낼 개수」만큼 골라 Gmail 로 보낸다.
// 기준선 이상이 없는 날은 「오늘은 없음」 메일을 보낸다.
// 메일 주소·앱 비밀번호는 환경변수(GitHub Secrets)에서만 읽는다: GMAIL_USER, GMAIL_APP_PASSWORD
// 실행: node mail.js   /   DRY_RUN=1 이면 보내지 않고 내용만 출력
const fs = require("fs");
const path = require("path");

const criteria = JSON.parse(fs.readFileSync(path.join(__dirname, "criteria.json"), "utf8"));
const LINE = criteria.기준선 ?? 60;
const COUNT = criteria["보낼 개수"] ?? 10;

function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(v => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== "")) rows.push(row);
  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] || ""])));
}

const all = parseCsv(fs.readFileSync(path.join(__dirname, "scored.csv"), "utf8"));
const passed = all.filter(j => Number(j.점수) >= LINE).sort((a, b) => b.점수 - a.점수);
const picked = passed.slice(0, COUNT);

const d = new Date(Date.now() + 9 * 3600 * 1000); // 한국 시간
const today = d.toISOString().slice(0, 10);
const h = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let subject, html, text;
if (!picked.length) {
  subject = `[공고 ${today}] 오늘은 없음`;
  text = `오늘은 ${LINE}점 이상 공고가 없습니다. (채점 ${all.length}건)`;
  html = `<p>${h(text)}</p>`;
} else {
  subject = `[공고 ${today}] ${LINE}점 이상 ${passed.length}건 중 상위 ${picked.length}건`;
  const head = `채점 ${all.length}건 중 ${LINE}점 이상 ${passed.length}건, 점수 높은 ${picked.length}건입니다.`;
  text = head + "\n\n" + picked.map((j, i) =>
    `${i + 1}. ${j.점수}점 ${j.회사} | ${j["공고 제목"]}\n   ${j.지역} / ${j.경력} / ${j["근무 형태"]} / 마감 ${j.마감일}\n   ${j.이유}\n   ${j.링크}`).join("\n\n");
  html = `<p>${h(head)}</p><ol>` + picked.map(j => `<li style="margin-bottom:14px">
<b>${h(j.점수)}점</b> ${h(j.회사)} | <a href="${h(j.링크)}">${h(j["공고 제목"])}</a><br>
${h(j.지역)} / ${h(j.경력)} / ${h(j["근무 형태"])} / 마감 ${h(j.마감일)} (${h(j.사이트)})<br>
<span style="color:#666;font-size:13px">${h(j.이유)}</span></li>`).join("") + "</ol>";
}

if (process.env.DRY_RUN) {
  console.log(`제목: ${subject}\n\n${text}`);
} else {
  const { GMAIL_USER: user, GMAIL_APP_PASSWORD: pass } = process.env;
  if (!user || !pass) {
    console.error("GMAIL_USER, GMAIL_APP_PASSWORD 가 없습니다. 저장소 Settings → Secrets and variables → Actions 에 넣었는지 확인하세요.");
    process.exit(1);
  }
  const nodemailer = require("nodemailer");
  const mailer = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s/g, "") } });
  mailer.sendMail({ from: user, to: user, subject, text, html })
    .then(() => console.log(`보냄: ${subject}`))
    .catch(e => { console.error(`메일 보내기 실패: ${e.message}`); process.exit(1); });
}
