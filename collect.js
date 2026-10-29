// 사람인·잡코리아에서 "마케팅" 검색 공고를 모아 jobs.csv로 저장한다. 제목에 마케팅·마케터·콘텐츠·홍보·SNS 가 든 공고만 남긴다.
// 외부 패키지 없이 Node 18+ 내장 fetch만 쓴다. 실행: node collect.js
const fs = require("fs");
const path = require("path");

const KEYWORD = "마케팅";
const TITLE_FILTER = /마케팅|마케터|콘텐츠|홍보|SNS/i;
const SARAMIN_PAGES = 2;  // 페이지당 100건
const JOBKOREA_PAGES = 5; // 페이지당 20건
const OUT = path.join(__dirname, "jobs.csv");
const COLUMNS = ["사이트", "회사", "공고 제목", "지역", "경력", "근무 형태", "마감일", "링크"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 모든 요청 사이에 1초를 둔다 (사이트가 달라도 동일).
// 네트워크 오류·타임아웃·5xx는 한 번 더 시도하고, 4xx(차단 등)는 바로 실패로 본다.
let lastRequestAt = 0;
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequestAt + 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "ko-KR,ko;q=0.9" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.text();
    } catch (e) {
      if (attempt === 2) throw e;
      continue;
    } finally {
      lastRequestAt = Date.now();
    }
    if (res.status < 500 || attempt === 2) throw new Error(`HTTP ${res.status}`);
  }
}

const KST_OFFSET = 9 * 3600 * 1000;
const kstToday = () => new Date(Date.now() + KST_OFFSET);
const ymd = d => d.toISOString().slice(0, 10);

const decode = s => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = html => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// ---------- 사람인 ----------
// "~ 11/08(일)" → 2026-11-08, 오늘마감·17시마감/내일마감 → 날짜, 채용시·상시채용은 그대로
function saraminDeadline(raw) {
  const today = kstToday();
  if (raw === "오늘마감" || /^\d{1,2}시마감$/.test(raw)) return ymd(today);
  if (raw === "내일마감") return ymd(new Date(today.getTime() + 86400000));
  const m = raw.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return raw;
  const month = +m[1], day = +m[2];
  let year = today.getUTCFullYear();
  if (month < today.getUTCMonth() + 1 - 1) year++; // 12월에 보는 1월 마감은 내년
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function saramin() {
  const rows = [];
  for (let page = 1; page <= SARAMIN_PAGES; page++) {
    const url = `https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(KEYWORD)}&recruitPage=${page}&recruitPageCount=100`;
    const html = await get(url);
    const items = html.split('class="item_recruit"').slice(1);
    if (!items.length) {
      if (page === 1) throw new Error("검색 결과 목록을 찾지 못함 (차단 또는 페이지 구조 변경)");
      break;
    }
    for (const it of items) {
      const id = (it.match(/^\s*value="(\d+)"/) || [])[1];
      const title = decode((it.match(/<h2 class="job_tit">[\s\S]*?title="([^"]*)"/) || [])[1] || "");
      const company = text((it.match(/<strong class="corp_name">([\s\S]*?)<\/strong>/) || [])[1] || "");
      const cond = (it.match(/<div class="job_condition">([\s\S]*?)<\/div>/) || [])[1] || "";
      const spans = [...cond.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(m => text(m[1]));
      const dateRaw = text((it.match(/<div class="job_date">\s*<span class="date">([\s\S]*?)<\/span>/) || [])[1] || "");
      rows.push({
        사이트: "사람인",
        회사: company,
        "공고 제목": title,
        지역: spans[0] || "",
        경력: spans.find(s => /신입|경력/.test(s)) || "",
        "근무 형태": spans[3] || "",
        마감일: dateRaw ? saraminDeadline(dateRaw) : "",
        링크: id ? `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}` : "",
      });
    }
  }
  return rows;
}

// ---------- 잡코리아 ----------
// 검색 페이지에 실린 Next.js 데이터(self.__next_f)에서 JOB_LIST(일반 검색 결과)와 CODES(코드표)를 꺼낸다.
function flightData(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map(m => JSON.parse('"' + m[1] + '"')).join("");
}

function extractQuery(all, keyPrefix) {
  const i = all.indexOf('"queryKey":[' + keyPrefix);
  if (i < 0) return null;
  const start = all.lastIndexOf('{"dehydratedAt"', i);
  let depth = 0, inStr = false, esc = false;
  for (let k = start; k < all.length; k++) {
    const c = all[k];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(all.slice(start, k + 1)).state.data;
  }
  return null;
}

function buildCodeMaps(codes) {
  const area = {};
  const walk = list => (list || []).forEach(a => { area[a.code] = a.tagDisplayName || a.displayName; walk(a.items); });
  walk(codes.area);
  const employment = Object.fromEntries((codes.employment || []).map(e => [e.code, e.displayName]));
  return { area, employment };
}

function jkCareer(type, range) {
  const years = range > 0 && range < 100 ? `${range}년↑` : "";
  if (type === "1") return "신입";
  if (type === "2") return "경력" + years;
  if (type === "3") return "신입·경력" + years;
  if (type === "4") return "경력무관";
  return "";
}

function jkEmployment(list, maps) {
  // "2/1" = 계약직 + 정규직 전환 가능 (공고 상세 페이지 표기로 확인)
  return (list || []).map(v => {
    const [code, conv] = String(v).split("/");
    const name = maps.employment[code] || "";
    return name && conv === "1" ? `${name}(정규직 전환 가능)` : name;
  }).filter(Boolean).join("·");
}

function jkDeadline(end) {
  if (!end) return "";
  const d = end.slice(0, 10);
  return d >= "2050" ? "상시채용" : d; // 잡코리아는 상시채용을 2070-01-01로 내려준다
}

async function jobkorea() {
  const rows = [];
  let maps = null;
  for (let page = 1; page <= JOBKOREA_PAGES; page++) {
    const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(KEYWORD)}&tabType=recruit&Page_No=${page}`;
    const all = flightData(await get(url));
    if (!maps) {
      const codes = extractQuery(all, '"CODES"');
      if (codes) maps = buildCodeMaps(codes);
    }
    const list = extractQuery(all, '"JOB_LIST"');
    if (!list || !maps) {
      if (page === 1) throw new Error("검색 결과 데이터를 찾지 못함 (차단 또는 페이지 구조 변경)");
      break;
    }
    if (!list.content.length) break;
    for (const j of list.content) {
      const areas = j.areaCodeList || [];
      const first = (maps.area[areas[0]] || "").replace(">", " ");
      rows.push({
        사이트: "잡코리아",
        회사: j.postingCompanyName || j.companyName || "",
        "공고 제목": j.title || "",
        지역: first && areas.length > 1 ? `${first} 외 ${areas.length - 1}` : first,
        경력: jkCareer(j.careerType, j.careerRange),
        "근무 형태": jkEmployment(j.employmentTypeCodeList, maps),
        마감일: jkDeadline(j.applicationPeriod && j.applicationPeriod.end),
        링크: `https://www.jobkorea.co.kr/Recruit/GI_Read/${j.id}`,
      });
    }
  }
  return rows;
}

// ---------- 저장 ----------
const csvCell = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

async function main() {
  const sites = [["사람인", saramin], ["잡코리아", jobkorea]];
  const rows = [];
  const failed = [];
  for (const [name, fn] of sites) {
    try {
      const got = await fn();
      const kept = got.filter(r => TITLE_FILTER.test(r["공고 제목"]));
      console.log(`${name}: 검색 ${got.length}건 중 제목 조건 통과 ${kept.length}건`);
      rows.push(...kept);
    } catch (e) {
      failed.push(name);
      console.warn(`${name}: 실패, 건너뜀 (${e.message})`);
    }
  }
  if (failed.length === sites.length) {
    console.error("모든 사이트가 실패해 jobs.csv를 덮어쓰지 않았습니다.");
    process.exit(1);
  }

  const seen = new Set();
  const unique = rows.filter(r => !seen.has(r.링크) && seen.add(r.링크));

  const lines = [COLUMNS.join(","), ...unique.map(r => COLUMNS.map(c => csvCell(r[c] || "")).join(","))];
  fs.writeFileSync(OUT, "﻿" + lines.join("\r\n") + "\r\n", "utf8"); // BOM: 엑셀 한글 깨짐 방지

  console.log(`\n저장: ${OUT}`);
  console.log(`총 ${unique.length}건 (${["사람인", "잡코리아"].map(s => `${s} ${unique.filter(r => r.사이트 === s).length}`).join(", ")})`);
  console.log("칸별 빈 값:");
  for (const c of COLUMNS) console.log(`  ${c}: ${unique.filter(r => !r[c]).length}`);
  if (failed.length) console.warn(`주의: ${failed.join(", ")} 수집 실패, 나머지 사이트 공고만 저장했습니다.`);
}

main();
