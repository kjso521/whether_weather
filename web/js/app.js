/* global d3, topojson, Scores */
(async function () {
  // 색은 노을 사진(docs/color.jpeg)에서 뽑은 팔레트를 쓴다. 밝은 화면과 다크 모드의 색을 따로 둔다:
  // 다크 모드에서는 "보통/낮음"이 어두운 배경 쪽으로 물러나고 양 끝만 밝게 보여야 구분이 된다.
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const themed = (light, dark) => (darkQuery.matches ? dark : light);
  const weatherKindOf = (label, light, dark) => ({ label, get color() { return themed(light, dark); } });
  const WEATHER = {
    clear: weatherKindOf("맑음", "#f6d3a3", "#e6b877"),
    partly: weatherKindOf("구름많음", "#e3e0ec", "#8884a0"),
    cloudy: weatherKindOf("흐림", "#b6b2c4", "#4f4e66"),
    rain: weatherKindOf("비", "#8db3d3", "#5b90c0"),
    sleet: weatherKindOf("비/눈", "#a8a4c9", "#7d79b3"),
    snow: weatherKindOf("눈", "#dbe3f0", "#c6d2ea"),
    shower: weatherKindOf("소나기", "#6a90b5", "#3d6f9e"),
  };
  const PTY_KIND = { 1: "rain", 2: "sleet", 3: "snow", 4: "shower" };
  const SKY_KIND = { 1: "clear", 3: "partly", 4: "cloudy" };
  const LOW = { light: "#f1eff6", dark: "#262a42" }; // 연속 색상 척도의 낮은 쪽(배경과 같은 계열)

  // layer.scale 이 현재 테마의 색 척도를 돌려주게 한다
  function withScale(layer, domain, lightColors, darkColors) {
    const light = d3.scaleLinear(domain, lightColors).clamp(true);
    const dark = d3.scaleLinear(domain, darkColors).clamp(true);
    return Object.defineProperty(layer, "scale", { get: () => themed(light, dark) });
  }

  // 지도에 칠할 수 있는 층. type: "score"(출사 지수) | "weather"(범주형 날씨) | "value"(예보 값)
  // 지수: 나쁨(분홍) → 보통(옅은 무채색) → 좋음(보라)
  const SCORE_LAYERS = Scores.MODES.map((mode) =>
    withScale(
      { ...mode, type: "score", unit: "점" },
      [0, 25, 50, 75, 100],
      ["#e27c92", "#f0b9c4", "#f0edf4", "#bdb7e6", "#857dc8"],
      ["#e07a91", "#874a64", "#2b2e48", "#655fa8", "#b9b3f2"]
    )
  );
  const WEATHER_LAYERS = [
    { id: "weather", label: "날씨", type: "weather" },
    withScale({ id: "POP", label: "강수확률", type: "value", unit: "%" }, [0, 100], [LOW.light, "#6f9cc0"], [LOW.dark, "#7fb5e0"]),
    withScale(
      { id: "TMP", label: "기온", type: "value", unit: "°" },
      [-10, 0, 10, 20, 30, 38],
      ["#5c5fa0", "#a9a6d0", LOW.light, "#f5d3a6", "#ee8fa3", "#c9506a"],
      ["#8f9af0", "#4f5596", LOW.dark, "#a67c4a", "#e0607a", "#ffa0b4"]
    ),
    withScale({ id: "WSD", label: "풍속", type: "value", unit: "m/s" }, [0, 12], [LOW.light, "#8d76b0"], [LOW.dark, "#c09be6"]),
    withScale({ id: "REH", label: "습도", type: "value", unit: "%" }, [0, 100], [LOW.light, "#7d9bb5"], [LOW.dark, "#8fb8d8"]),
  ];
  const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  const RANKING_SIZE = 10;
  const LABEL_PX = 10; // 지명 글씨 크기(--fs-label). 겹침 계산에 쓴다
  const LABELS_KEY = "ww-labels-shown"; // 지명 표시 여부를 기억하는 localStorage 키
  // 지도를 맞출 범위(본토 + 제주). 울릉도·백령도까지 넣으면 좁은 화면에서 본토가 너무 작아져서, 먼 섬은 이동/확대로 본다.
  const MAINLAND_EXTENT = { type: "MultiPoint", coordinates: [[125.9, 33.1], [129.7, 38.65]] };
  const KOREA_CENTER = { lat: 36.3, lon: 127.8 }; // 모드 대상 시간대를 찾을 때 쓰는 기준점

  const [topo, regions, weather] = await Promise.all(
    ["data/sigungu.topo.json", "data/regions.json", "data/weather_latest.json"].map((url) =>
      // no-cache: 저장된 사본을 쓰기 전에 서버에 바뀌었는지 물어본다 (예보가 3시간마다 갱신되므로)
      fetch(url, { cache: "no-cache" }).then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
      })
    )
  );

  // 시각은 모두 KST 문자열("2026-10-05T06:00+09:00")이므로, 화면 표시는 보는 사람의 시간대와 무관하게 문자열로 다룬다.
  // 시간축은 연속이 아닐 수 있다(먼 미래는 3시간 간격).
  const hours = weather.hours;
  const hourDates = hours.map((h) => new Date(h)); // 천문 계산용 절대 시각
  const dateOf = (h) => h.slice(0, 10);
  const hourOf = (h) => Number(h.slice(11, 13));
  const nowKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString(); // "2026-10-05T19:30:..." (KST)
  // 지금 시각 이후 첫 예보 시각
  const nowIndex = () => Math.max(0, hours.findIndex((h) => h.slice(0, 13) >= nowKst().slice(0, 13)));

  const state = {
    layer: SCORE_LAYERS[0],
    index: nowIndex(),
    selected: null,
    labels: localStorage.getItem(LABELS_KEY) === "on", // 기본은 지명 숨김
  };

  const seriesOf = (code) => {
    const r = regions[code];
    return r && weather.grids[`${r.nx},${r.ny}`];
  };
  const valueAt = (code, name, index) => seriesOf(code)?.[name]?.[index] ?? null;
  const weatherKind = (code, index) => {
    const pty = valueAt(code, "PTY", index);
    if (pty) return PTY_KIND[pty] ?? "rain";
    return SKY_KIND[valueAt(code, "SKY", index)] ?? null;
  };
  const scoreAt = (code, layer, index) =>
    Scores.score(layer.id, { lat: regions[code].lat, lon: regions[code].lon, hours: hourDates, index, series: seriesOf(code) });
  // 현재 층에서 한 지역·시각의 숫자 값 (날씨 층은 숫자가 없으므로 null)
  const layerValue = (code, layer, index) =>
    layer.type === "score" ? scoreAt(code, layer, index) : layer.type === "value" ? valueAt(code, layer.id, index) : null;
  const fmt = (value, unit = "") => (value == null ? "–" : `${Math.round(value * 10) / 10}${unit}`);

  function fillOf(code) {
    if (state.layer.type === "weather") {
      const kind = weatherKind(code, state.index);
      return kind ? WEATHER[kind].color : "var(--no-data)";
    }
    const value = layerValue(code, state.layer, state.index);
    return value == null ? "var(--no-data)" : state.layer.scale(value);
  }

  function timeLabel(index) {
    const date = dateOf(hours[index]);
    const [, month, day] = date.split("-").map(Number);
    const weekday = DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
    return `${month}.${day} (${weekday}) ${hourOf(hours[index])}시`;
  }
  // 범례와 표의 색 견본. 지도와 똑같이 SVG로 그려서, 브라우저의 강제 다크 모드 등이 CSS 배경색만 바꿔 놓아
  // 범례와 지도의 색이 달라지는 일을 막는다.
  const swatch = (color) => `<svg class="swatch" viewBox="0 0 1 1"><rect width="1" height="1" fill="${color}"/></svg>`;
  // 지도 위 지명은 "서울", "용인", "고성"처럼 시·군·구를 뗀 짧은 이름으로 쓴다
  const labelOf = (code) => regions[code].name.replace(/[시군구]$/, "");
  const fullName = (code) => `${regions[code].sido} ${regions[code].name}`;

  // 한 줄 요약: "맑음 · 18° · 나들이 92점"
  function summary(code) {
    const kind = weatherKind(code, state.index);
    const parts = [kind ? WEATHER[kind].label : "자료 없음", fmt(valueAt(code, "TMP", state.index), "°")];
    if (state.layer.type === "score" || (state.layer.type === "value" && state.layer.id !== "TMP")) {
      parts.push(`${state.layer.label} ${fmt(layerValue(code, state.layer, state.index), state.layer.unit)}`);
    }
    return parts.join(" · ");
  }

  // ---- 지도 ----
  const svg = d3.select("#map");
  const object = Object.values(topo.objects)[0];
  // regions.json의 지역 하나가 도형 하나. 구를 합친 도시(members가 있음)는 구 경계를 녹여 한 덩어리로 만든다.
  const features = Object.entries(regions).map(([code, region]) => {
    const members = new Set(region.members ?? [code]);
    const parts = object.geometries.filter((g) => members.has(g.properties.code));
    const geometry = region.members ? topojson.merge(topo, parts) : topojson.feature(topo, parts[0]).geometry;
    return { type: "Feature", properties: { code }, geometry };
  });
  const layer = svg.append("g");
  const paths = layer.selectAll("path.region").data(features).join("path").attr("class", "region");
  const labelLayer = layer.append("g").attr("class", "labels");
  const labels = labelLayer
    .selectAll("text")
    .data(features)
    .join("text")
    .text((d) => labelOf(d.properties.code));
  const mapReset = document.getElementById("map-reset");
  const zoom = d3
    .zoom()
    .scaleExtent([1, 10])
    .on("zoom", (event) => {
      layer.attr("transform", event.transform);
      layoutLabels(event.transform);
      const { k, x, y } = event.transform;
      mapReset.hidden = k === 1 && Math.abs(x) < 1 && Math.abs(y) < 1;
    });
  svg.call(zoom);
  mapReset.addEventListener("click", () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity));

  // 지명은 확대해도 화면에서 같은 크기로 보이게 하고, 겹치는 것은 우선순위가 높은 것부터 남기고 숨긴다.
  // 확대할수록 자리가 생겨 더 많은 지명이 나타난다.
  let labelOrder = [];
  function layoutLabels(transform = d3.zoomTransform(svg.node())) {
    labelLayer.attr("display", state.labels ? null : "none");
    if (!state.labels) return;
    const { width, height } = svg.node().getBoundingClientRect();
    const placed = [];
    const visible = new Set();
    for (const d of labelOrder) {
      const x = transform.applyX(d.labelX);
      const y = transform.applyY(d.labelY);
      const halfW = (labelOf(d.properties.code).length * LABEL_PX) / 2 + 3;
      const halfH = LABEL_PX / 2 + 2;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      if (placed.some((p) => Math.abs(p.x - x) < p.halfW + halfW && Math.abs(p.y - y) < p.halfH + halfH)) continue;
      placed.push({ x, y, halfW, halfH });
      visible.add(d);
    }
    labels
      .attr("display", (d) => (visible.has(d) ? null : "none"))
      .attr("transform", (d) => `translate(${d.labelX},${d.labelY}) scale(${1 / transform.k})`);
  }

  function layoutMap() {
    const { width, height } = svg.node().getBoundingClientRect();
    if (!width || !height) return;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const projection = d3.geoMercator().fitSize([width, height], MAINLAND_EXTENT);
    const path = d3.geoPath(projection);
    paths.attr("d", path);
    for (const d of features) {
      const { lat, lon } = regions[d.properties.code];
      [d.labelX, d.labelY] = projection([lon, lat]);
      d.area = path.area(d);
    }
    // 지명 우선순위: 구를 합친 큰 도시(서울 등)가 먼저, 그다음은 넓은 지역 순
    const isCity = (d) => (regions[d.properties.code].members ? 1 : 0);
    labelOrder = [...features].sort((a, b) => isCity(b) - isCity(a) || b.area - a.area);
    svg.call(zoom.transform, d3.zoomIdentity); // zoom 이벤트가 지명 배치까지 다시 한다
  }
  layoutMap();
  window.addEventListener("resize", layoutMap);

  const tooltip = document.getElementById("tooltip");
  const mapWrap = document.querySelector(".map-wrap");
  paths
    .on("pointermove", (event, d) => {
      if (event.pointerType === "touch") return;
      const box = mapWrap.getBoundingClientRect();
      tooltip.hidden = false;
      tooltip.innerHTML = "<b></b><br><span></span>";
      tooltip.querySelector("b").textContent = fullName(d.properties.code);
      tooltip.querySelector("span").textContent = summary(d.properties.code);
      // 오른쪽 끝에서는 툴팁이 잘리지 않게 왼쪽으로 띄운다
      const x = event.clientX - box.left;
      tooltip.style.left = `${x > box.width - 200 ? x - tooltip.offsetWidth - 24 : x}px`;
      tooltip.style.top = `${event.clientY - box.top}px`;
    })
    .on("pointerleave", () => (tooltip.hidden = true))
    .on("click", (event, d) => {
      // 선택된 지역을 다시 누르면 선택 해제
      state.selected = state.selected === d.properties.code ? null : d.properties.code;
      render();
    });
  // 지도의 빈 곳(바다)을 누르면 선택 해제. 끌어서 옮길 때는 d3.zoom이 click을 막아 주므로 해제되지 않는다.
  svg.on("click", (event) => {
    if (event.target !== svg.node() || !state.selected) return;
    state.selected = null;
    render();
  });

  // ---- 서랍 메뉴(모바일) ----
  const side = document.getElementById("side");
  const backdrop = document.getElementById("backdrop");
  const menuButton = document.getElementById("menu");
  function setMenuOpen(open) {
    side.classList.toggle("open", open);
    backdrop.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", () => setMenuOpen(true));
  document.getElementById("close").addEventListener("click", () => setMenuOpen(false));
  backdrop.addEventListener("click", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => event.key === "Escape" && setMenuOpen(false));

  const picked = document.getElementById("picked");
  picked.addEventListener("click", () => {
    setMenuOpen(true);
    document.getElementById("detail").scrollIntoView({ block: "start" });
  });

  // ---- 컨트롤 ----
  function makeChips(container, items, isActive, onPick) {
    const root = d3.select(container);
    root
      .selectAll("button")
      .data(items)
      .join("button")
      .attr("class", "chip")
      .attr("type", "button")
      .text((d) => d.label)
      .on("click", (event, d) => onPick(d));
    return () => root.selectAll("button").attr("aria-pressed", (d) => String(isActive(d)));
  }

  // 일출·은하수처럼 특정 시간대만 해당하는 모드를 고르면, 지금 이후 가장 가까운 해당 시각으로 옮긴다.
  function jumpToApplicableHour(layer) {
    const ok = (i) => Scores.applies(layer.id, KOREA_CENTER.lat, KOREA_CENTER.lon, hourDates[i]);
    if (ok(state.index)) return;
    const order = [...hours.keys()].filter((i) => i > state.index).concat([...hours.keys()].filter((i) => i < state.index).reverse());
    const found = order.find(ok);
    if (found != null) state.index = found;
  }

  function pickLayer(layer) {
    state.layer = layer;
    if (layer.type === "score") jumpToApplicableHour(layer);
    render();
  }
  const isCurrentLayer = (d) => d === state.layer;
  const updateScoreChips = makeChips("#score-chips", SCORE_LAYERS, isCurrentLayer, pickLayer);
  const updateWeatherChips = makeChips("#weather-chips", WEATHER_LAYERS, isCurrentLayer, pickLayer);
  const slider = document.getElementById("hour");
  const hourLabel = document.getElementById("hour-label");
  slider.min = 0;
  slider.max = hours.length - 1;
  slider.addEventListener("input", () => {
    state.index = Number(slider.value);
    render();
  });
  // 슬라이더는 손가락으로 한 칸씩 옮기기 어려워서 앞뒤 버튼을 둔다 (먼 미래는 예보가 3시간 간격이라 한 칸 = 3시간)
  const prevBtn = document.getElementById("hour-prev");
  const nextBtn = document.getElementById("hour-next");
  const stepHour = (delta) => {
    const next = Math.min(hours.length - 1, Math.max(0, state.index + delta));
    if (next === state.index) return;
    state.index = next;
    render();
  };
  prevBtn.addEventListener("click", () => stepHour(-1));
  nextBtn.addEventListener("click", () => stepHour(1));
  const nowBtn = document.getElementById("hour-now");
  nowBtn.addEventListener("click", () => stepHour(nowIndex() - state.index));

  // ---- 범례 ----
  function renderLegend() {
    const legend = d3.select("#legend").html("");
    const { scale, unit, label, type } = state.layer;
    legend.append("div").attr("class", "legend-title").text(label);
    if (type === "weather") {
      legend
        .append("div")
        .attr("class", "legend-items")
        .selectAll("span")
        .data(Object.values(WEATHER))
        .join("span")
        .attr("class", "legend-item")
        .html((d) => `${swatch(d.color)}${d.label}`);
      return;
    }
    const domain = scale.domain();
    const stops = d3.range(0, 1.001, 0.025).map((t) => scale(domain[0] + t * (domain.at(-1) - domain[0])));
    legend
      .append("svg")
      .attr("class", "legend-bar")
      .attr("viewBox", `0 0 ${stops.length} 1`)
      .attr("preserveAspectRatio", "none")
      .attr("shape-rendering", "crispEdges")
      .selectAll("rect")
      .data(stops)
      .join("rect")
      .attr("x", (d, i) => i)
      .attr("width", 1)
      .attr("height", 1)
      .attr("fill", (d) => d);
    legend
      .append("div")
      .attr("class", "legend-ticks")
      .selectAll("span")
      .data([domain[0], domain.at(-1)])
      .join("span")
      .text((d, i) => (type === "score" ? ["나쁨", "좋음"][i] : `${d}${unit}`));
  }

  // ---- 추천 순위 ----
  function renderRanking() {
    const section = document.getElementById("ranking-section");
    section.hidden = state.layer.type !== "score";
    if (section.hidden) return;
    const ranked = Object.keys(regions)
      .map((code) => ({ code, points: scoreAt(code, state.layer, state.index) }))
      .filter((d) => d.points != null)
      .sort((a, b) => b.points - a.points)
      .slice(0, RANKING_SIZE);
    const list = d3.select("#ranking");
    list.selectAll("li").remove();
    if (!ranked.length) {
      list.append("li").attr("class", "note").text("이 시각은 이 모드의 대상 시간대가 아닙니다.");
      return;
    }
    const buttons = list
      .selectAll("li")
      .data(ranked)
      .join("li")
      .append("button")
      .attr("type", "button")
      .on("click", (event, d) => {
        state.selected = d.code;
        setMenuOpen(false);
        render();
      });
    buttons.append("span").attr("class", "sido").text((d) => regions[d.code].sido);
    buttons.append("span").attr("class", "name").text((d) => regions[d.code].name);
    buttons.append("span").attr("class", "points").text((d) => d.points);
  }

  // ---- 상세 ----
  function renderDetail() {
    const code = state.selected;
    picked.hidden = !code;
    if (!code) {
      d3.select("#detail").html('<p class="note">지도에서 지역을 선택하면 시간별 예보가 표시됩니다.</p>');
      return;
    }
    picked.innerHTML = "<b></b> · <span></span>";
    picked.querySelector("b").textContent = regions[code].name;
    picked.querySelector("span").textContent = summary(code);

    const root = d3.select("#detail");
    const i = state.index;
    const kind = weatherKind(code, i);
    const isScore = state.layer.type === "score";
    const dayIndexes = [...hours.keys()].filter((j) => dateOf(hours[j]) === dateOf(hours[i]));

    root.html(`
      <div class="where"></div>
      <h2></h2>
      <div class="now"><span class="temp">${fmt(valueAt(code, "TMP", i), "°")}</span><span>${kind ? WEATHER[kind].label : "자료 없음"}</span></div>
      <div class="stats">
        <div class="stat"><span>${isScore ? state.layer.label : "강수확률"}</span><b>${
          isScore ? fmt(scoreAt(code, state.layer, i), "점") : fmt(valueAt(code, "POP", i), "%")
        }</b></div>
        <div class="stat"><span>습도</span><b>${fmt(valueAt(code, "REH", i), "%")}</b></div>
        <div class="stat"><span>풍속</span><b>${fmt(valueAt(code, "WSD", i), "m/s")}</b></div>
      </div>
      <table class="hourly">
        <thead><tr><th>시각</th><th>날씨</th><th>기온</th><th>강수</th><th>습도</th><th>풍속</th>${isScore ? "<th>점수</th>" : ""}</tr></thead>
        <tbody></tbody>
      </table>`);
    root.select(".where").text(`${regions[code].sido} · ${timeLabel(i)}`);
    root.select("h2").text(regions[code].name);
    root
      .select("tbody")
      .selectAll("tr")
      .data(dayIndexes)
      .join("tr")
      .classed("current", (j) => j === i)
      .on("click", (event, j) => {
        state.index = j;
        render();
      })
      .html((j) => {
        const k = weatherKind(code, j);
        return `<td>${hourOf(hours[j])}시</td>
          <td>${swatch(k ? WEATHER[k].color : "var(--no-data)")} ${k ? WEATHER[k].label : "–"}</td>
          <td>${fmt(valueAt(code, "TMP", j), "°")}</td><td>${fmt(valueAt(code, "POP", j), "%")}</td>
          <td>${fmt(valueAt(code, "REH", j), "%")}</td><td>${fmt(valueAt(code, "WSD", j))}</td>
          ${isScore ? `<td>${fmt(scoreAt(code, state.layer, j))}</td>` : ""}`;
      });
  }

  // ---- 전체 갱신 ----
  let legendFor = null;
  function render() {
    paths.attr("fill", (d) => fillOf(d.properties.code)).classed("selected", (d) => d.properties.code === state.selected);
    paths.filter((d) => d.properties.code === state.selected).raise();
    labelLayer.raise(); // 선택한 지역을 맨 위로 올려도 지명은 그 위에 남게 한다

    slider.value = state.index;
    hourLabel.textContent = timeLabel(state.index);
    prevBtn.disabled = state.index === 0;
    nextBtn.disabled = state.index === hours.length - 1;
    nowBtn.disabled = state.index === nowIndex();

    updateScoreChips();
    updateWeatherChips();
    if (legendFor !== state.layer) {
      renderLegend();
      document.getElementById("layer-note").textContent = state.layer.note ?? "";
      legendFor = state.layer;
    }
    renderRanking();
    renderDetail();
  }

  const labelsToggle = document.getElementById("labels-toggle");
  function setLabels(on) {
    state.labels = on;
    labelsToggle.setAttribute("aria-pressed", String(on));
    layoutLabels();
  }
  labelsToggle.addEventListener("click", () => {
    setLabels(!state.labels);
    localStorage.setItem(LABELS_KEY, state.labels ? "on" : "off");
  });
  setLabels(state.labels);

  darkQuery.addEventListener("change", () => {
    legendFor = null;
    render();
  });

  const meta = document.getElementById("meta");
  meta.textContent = `예보 발표 ${weather.baseTime.slice(5, 16).replace("-", ".").replace("T", " ")}${weather.sample ? " · 샘플 데이터(실제 날씨 아님)" : ""}`;

  // ---- 지도 바로 위 한 줄 알림: 예보가 오래되면 경고, 아니면 예보에서 뽑은 팁을 돌려 보여준다 ----
  // 발표는 3시간마다라서, 발표 후 4시간이 지나도 새 발표분이 없으면 1시간 넘게 늦어진 것이다.
  const STALE_AFTER = 4 * 3600e3;
  const TIP_EVERY = 8000;
  const banner = document.getElementById("banner");
  const tips = buildTips();
  let tipIndex = 0;
  let current = null;
  function showBanner() {
    const late = !weather.sample && Date.now() - Date.parse(weather.baseTime) > STALE_AFTER;
    current = late ? { text: `⚠ 예보 갱신 지연 중 (${hourOf(weather.baseTime)}시 발표)` } : tips[tipIndex % tips.length];
    banner.classList.toggle("warn", late);
    banner.textContent = current?.text ?? "";
    fitBanner();
  }
  // 한 줄에 다 들어가도록 글씨를 조금씩 줄인다 (그래도 넘치면 말줄임)
  const BANNER_MIN_PX = 9;
  function fitBanner() {
    banner.style.fontSize = "";
    let size = parseFloat(getComputedStyle(banner).fontSize);
    while (banner.scrollWidth > banner.clientWidth && size > BANNER_MIN_PX) {
      size -= 0.5;
      banner.style.fontSize = `${size}px`;
    }
  }
  window.addEventListener("resize", fitBanner);
  document.fonts?.ready.then(fitBanner); // 웹 글꼴이 늦게 오면 글자 폭이 바뀐다
  function nextTip() {
    if (banner.classList.contains("warn") || tips.length < 2) return showBanner();
    banner.classList.add("fading");
    setTimeout(() => {
      tipIndex++;
      showBanner();
      banner.classList.remove("fading");
    }, 300);
  }
  // 지역이 있는 팁을 누르면 그 지역을 선택하고, 아니면 다음 팁으로 넘긴다
  banner.addEventListener("click", () => {
    if (current?.code) {
      state.selected = current.code;
      if (current.index != null) state.index = current.index;
      render();
    } else nextTip();
  });
  showBanner();
  setInterval(nextTip, TIP_EVERY);

  // 오늘(저녁 6시 이후면 내일) 예보에서 눈에 띄는 것을 골라 짧은 문장으로 만든다
  function buildTips() {
    const now = nowKst();
    const today = now.slice(0, 10);
    const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
    const evening = Number(now.slice(11, 13)) >= 18;
    const day = evening ? addDays(today, 1) : today;
    const dayWord = evening ? "내일" : "오늘";
    const nextWord = evening ? "모레" : "내일";
    const isFuture = (i) => hours[i].slice(0, 13) >= now.slice(0, 13);
    const idx = (test) => [...hours.keys()].filter((i) => isFuture(i) && test(dateOf(hours[i]), hourOf(hours[i])));
    const daytime = idx((d, h) => d === day && h >= 9 && h <= 18);
    const codes = Object.keys(regions);
    // 시각들 중 각 지역의 최고 점수, 그중 1등 지역
    const best = (layerId, indexes) => {
      const layer = SCORE_LAYERS.find((l) => l.id === layerId);
      let top = null;
      for (const code of codes)
        for (const i of indexes) {
          const v = scoreAt(code, layer, i);
          if (v != null && (!top || v > top.v)) top = { code, i, v };
        }
      return top;
    };
    const extreme = (name, indexes, sign) => {
      let top = null;
      for (const code of codes)
        for (const i of indexes) {
          const v = valueAt(code, name, i);
          if (v != null && (!top || sign * v > sign * top.v)) top = { code, i, v };
        }
      return top;
    };
    const name = (code) => labelOf(code);
    const out = [];

    if (daytime.length) {
      const rainy = codes.filter((c) => daytime.some((i) => valueAt(c, "PTY", i) > 0));
      if (rainy.length >= codes.length * 0.6) out.push({ text: `☔ ${dayWord} 전국 대부분 비 소식, 우산 챙기세요` });
      else if (rainy.length) {
        const bySido = d3.rollups(rainy, (v) => v.length, (c) => regions[c].sido).sort((a, b) => b[1] - a[1]);
        out.push({ text: `☔ ${dayWord} ${bySido[0][0]} 쪽 비 소식` });
      } else out.push({ text: `☀ ${dayWord} 전국 비 소식 없음` });

      // 나들이: 낮 시간 평균 점수가 높은 곳 중 하나를 골라 매번 조금 다르게 보여준다
      const outing = SCORE_LAYERS.find((l) => l.id === "outing");
      const avg = codes
        .map((code) => {
          const v = daytime.map((i) => scoreAt(code, outing, i)).filter((x) => x != null);
          return { code, v: v.length ? d3.mean(v) : null };
        })
        .filter((d) => d.v != null)
        .sort((a, b) => b.v - a.v);
      if (avg.length && avg[0].v >= 60) {
        const pick = avg[Math.floor(Math.random() * Math.min(3, avg.length))];
        const lines = [`${dayWord}은 ${name(pick.code)} 나들이 어때요?`, `🚶 ${dayWord} 걷기 좋은 곳: ${name(pick.code)}`, `🌿 ${dayWord} ${name(pick.code)} 바람 쐬기 좋아요`];
        out.push({ text: lines[Math.floor(Math.random() * lines.length)], code: pick.code, index: daytime[0] });
      }

      const hot = extreme("TMP", daytime, 1);
      if (hot && hot.v >= 28) out.push({ text: `🥵 ${dayWord} 최고 ${Math.round(hot.v)}° (${name(hot.code)})`, code: hot.code, index: hot.i });
      const windy = extreme("WSD", daytime, 1);
      if (windy && windy.v >= 9) out.push({ text: `💨 ${name(windy.code)} 강풍 ${Math.round(windy.v)}m/s`, code: windy.code, index: windy.i });
    }
    const morning = idx((d, h) => d === day && h >= 5 && h <= 8);
    const cold = extreme("TMP", morning, -1);
    if (cold && cold.v <= 5) out.push({ text: `🧥 ${dayWord} 아침 최저 ${Math.round(cold.v)}° (${name(cold.code)})`, code: cold.code, index: cold.i });

    const sunset = best("golden", idx((d, h) => d === day && h >= 15));
    if (sunset && sunset.v >= 70) out.push({ text: `🌅 ${dayWord} 노을 명소: ${name(sunset.code)}`, code: sunset.code, index: sunset.i });
    const sunrise = best("golden", idx((d, h) => d === addDays(day, 1) && h <= 9));
    if (sunrise && sunrise.v >= 70) out.push({ text: `🌄 ${nextWord} 일출 명소: ${name(sunrise.code)}`, code: sunrise.code, index: sunrise.i });
    const stars = best("stars", idx((d, h) => (d === day && h >= 19) || (d === addDays(day, 1) && h <= 4)));
    if (stars && stars.v >= 60) out.push({ text: `✨ ${dayWord} 밤 은하수: ${name(stars.code)} 유망`, code: stars.code, index: stars.i });
    const clouds = best("seaOfClouds", idx((d, h) => d === addDays(day, 1) && h <= 9));
    if (clouds && clouds.v >= 70) out.push({ text: `☁ ${nextWord} 새벽 ${name(clouds.code)} 운해 가능성`, code: clouds.code, index: clouds.i });

    // 예보 팁을 섞은 뒤, 사용법 팁을 하나 끼워 둔다
    d3.shuffle(out);
    const howTo = [
      "지역을 누르면 시간별 예보가 나와요",
      "−1h / +1h로 한 시간씩 이동",
      "'지금'을 누르면 현재 시각으로",
      "홈 화면에 추가해 앱처럼 쓰기",
      "'지명'을 누르면 지역 이름 표시",
    ];
    out.push({ text: `💡 ${howTo[Math.floor(Math.random() * howTo.length)]}` });
    return out;
  }

  render();
})().catch((error) => {
  document.querySelector(".map-wrap").textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
});
