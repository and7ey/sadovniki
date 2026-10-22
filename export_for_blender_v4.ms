/* ==================================================================
   export_for_blender.ms   v4
   Подготовка сцены 3ds Max и выгрузка FBX для Blender.
   База - v3 (авторская правка синтаксиса и путей).

   ЧТО ИСПРАВЛЕНО ПО СРАВНЕНИЮ С v3 (по разбору 5_3_blender.fbx):
     - УБРАН блок "units.SystemType = #Centimeters; MetricType = #Meters".
       Именно он ломал масштаб: файл приходил в 10 раз крупнее
       (стены 148.4 м вместо 14.84 м). Единицы теперь только читаются
       и печатаются в отчёт, ничего не меняется.
     - Материалы собираются ОБХОДОМ ОБЪЕКТОВ (o.material + вложенные
       Multi/Sub-Object), а не getClassInstances Material: в этой сцене
       он вернул 0, из-за чего шаги 3-6 дружно дали 0 и текстуры не
       попали в FBX (0 картинок вшито).
     - Оболочка дома ищется по ОБЪЁМУ габарита (а не по площади следа):
       прежний выбор пал на плоский блок 148 x 433 м нулевой высоты.
     - Новый отчёт [4] "сколько карт реально найдено на диске" -
       именно он предсказывает, вшейтся ли текстура.
     - Отчёт пишется в UTF-8 (в v3 кириллица превратилась в "?").

   ЧТО ОСТАЛОСЬ ИЗ v3:
     - mapPaths.count -> mapPaths.count()  (иначе "Unable to convert:
       count() to type: Integer" в exbMapDirs).
     - local fn -> local fname в блоке починки путей к текстурам
       (fn - зарезервированное слово MAXScript, "Syntax error: at
       function, expected name").
     - EXB_DELETE_FAR: счётчик delN фиксируется ДО delete, иначе в
       отчёте всегда 0.
     - Новый exbEnsureDir: создаёт EXB_OUT_DIR, если её нет, и
       сообщает, если не удалось (частая причина "FBX 0 байт").
     - §10: экспорт проверяется по doesFileExist И по размеру файла.
       Если FBX весит 0 байт - явная ошибка с подсказкой про
       selectedOnly, а не молчаливое "0.0 МБ".
     - §2: перед select выполняется unfreeze/unhide для exportSet и
       печатается фактическое selection.count - видно, выделилось
       ли что-то на самом деле.
     - Отчёт: если в EXB_OUT_DIR писать нельзя - падает во
       getDir #temp, а не тихо проваливается.

   СОХРАНЕНО ИЗ v2:
     - Классы Corona/V-Ray определяются по подстроке в имени класса
       (CoronaBitmap, VRayBitmap, CoronaMtl, VRayMtl...), а не по
       жёсткому списку.
     - exbIsGeometry работает через GeometryClass.
     - Убран параметр ConvertUnit (из-за него FBX выходил x100).
     - Лог FBX-параметров и контроль масштаба оболочки дома.
     - prepared_ больше не накапливается.

   ЧТО ДЕЛАЕТ:
     1. Единицы только ЧИТАЕТ (не меняет!); печатает в отчёт.
     2. Оболочка дома по наибольшему объёму габарита; отсев далёкого
        мусора (EXB_DELETE_FAR = false - только исключить, не удалять).
     3. Разворачивает цепочки карт (Corona/VRay wrapper -> Bitmap).
     4. Чинит пути к текстурам по mapPaths и папке сцены.
     5. Чёрный цвет при наличии карты -> белый.
     6. Corona/VRay -> Physical Material (включая Multi/Sub-Object).
     7. UVWMap(Box) объектам без развёртки.
     8. Копия prepared_<имя>.max.
     9. (опция) контрольный рендер.
    10. Экспорт FBX с проверкой размера.
    11. Отчёт export_report.txt.

   КАК ЗАПУСКАТЬ: Scripting -> Run Script... или перетащить .ms.
   В путях - двойные обратные слеши: "C:\\Users\\...\\"
   ================================================================== */

global EXB_OUT_DIR      = "C:\\Users\\lluky\\Downloads\\3dplan\\"
global EXB_OUT_NAME     = "5_4_blender.fbx"
global EXB_SELECTED     = true
global EXB_CONVERT      = true
global EXB_FLATTEN      = true
global EXB_FIX_BLACK    = true
global EXB_REPAIR       = true
global EXB_ADD_UVW      = true
global EXB_FAR_FACTOR   = 1.6
global EXB_DELETE_FAR   = false
global EXB_PREVIEW      = false
global EXB_PREVIEW_RES  = 1400
global EXB_LOG          = #()

fn exbSay s = (
  local t = s as string
  t = substituteString t "%" "%%"
  format "%\n" t
  append EXB_LOG (t as string)
)

fn exbClass x = (
  local r = "?"
  try ( r = (classof x) as string ) catch ( r = "?" )
  toLower r
)

fn exbSetProp obj prop val = (
  local ok = false
  try ( setProperty obj prop val; ok = true ) catch ( ok = false )
  ok
)

fn exbGetProp obj prop = (
  local v = undefined
  try ( v = getProperty obj prop ) catch ( v = undefined )
  v
)

-- любая растровая карта: Bitmaptex, BitmapTexture, CoronaBitmap, VRayBitmap ...
fn exbIsBitmap x = (
  if x == undefined then return false
  local c = exbClass x
  (findString c "bitmap") != undefined
)

-- материалы сторонних движков: Corona*, VRay* (кроме источников света)
fn exbIsThirdParty mat = (
  local c = exbClass mat
  local isEngine = false
  if (findString c "corona") != undefined then isEngine = true
  if (findString c "vray")   != undefined then isEngine = true
  if isEngine and ((findString c "light") != undefined) then isEngine = false
  isEngine
)

fn exbIsLightMtl mat = (
  local c = exbClass mat
  (findString c "light") != undefined and ((findString c "corona") != undefined or (findString c "vray") != undefined)
)

fn exbDeepBitmap m depth = (
  if m == undefined or depth > 8 then return undefined
  if exbIsBitmap m then return m
  local n = 0
  try ( n = getNumSubTexmaps m ) catch ( n = 0 )
  local res = undefined
  local i = 1
  while i <= n and res == undefined do (
    local sub = undefined
    try ( sub = getSubTexmap m i ) catch ( sub = undefined )
    if sub != undefined then res = exbDeepBitmap sub (depth + 1)
    i = i + 1
  )
  res
)

fn exbFirstMap mat names = (
  local res = undefined
  for pn in names while res == undefined do (
    local v = exbGetProp mat pn
    if v != undefined and isKindOf v TextureMap then res = v
  )
  if res == undefined then (
    local n = 0
    try ( n = getNumSubTexmaps mat ) catch ( n = 0 )
    local i = 1
    while i <= n and res == undefined do (
      local s = undefined
      try ( s = getSubTexmap mat i ) catch ( s = undefined )
      if s != undefined then res = s
      i = i + 1
    )
  )
  res
)

fn exbMaterialToPhysical mat = (
  local baseMap = exbFirstMap mat #("diffuseMap", "texmapDiffuse", "texmap_diffuse", "base_color_map", "texmapBaseColor")
  local roughMap = exbFirstMap mat #("roughnessMap", "texmapRoughness", "texmap_roughness", "texmapReflectGlossiness")
  local bumpMap = exbFirstMap mat #("bumpMap", "texmapBump", "texmap_bump", "normalMap")
  local opacMap = exbFirstMap mat #("opacityMap", "texmapOpacity", "texmap_opacity", "transparencyMap")
  local col = undefined
  for pn in #("diffuse", "colorDiffuse", "base_color", "diffuseColor") while col == undefined do (
    local c = exbGetProp mat pn
    if c != undefined and isKindOf c Color then col = c
  )
  if col == undefined then col = color 200 200 200

  local rough = 0.45
  local refl = exbGetProp mat "reflectivity"
  if refl != undefined and isKindOf refl Float then rough = 1.0 - (refl * 0.7)

  local pm = undefined
  try ( pm = PhysicalMaterial() ) catch ( pm = undefined )
  if pm == undefined then return undefined

  exbSetProp pm "base_color" col
  if baseMap != undefined then exbSetProp pm "base_color_map" baseMap
  if bumpMap != undefined then exbSetProp pm "bump_map" bumpMap
  if opacMap != undefined then exbSetProp pm "transparency_map" opacMap
  exbSetProp pm "roughness" rough
  if roughMap != undefined then exbSetProp pm "roughness_map" roughMap
  local metal = exbGetProp mat "metalness"
  if metal == undefined then metal = exbGetProp mat "metal"
  if metal != undefined and isKindOf metal Float then exbSetProp pm "metalness" metal
  pm
)

fn exbSwapMaterial oldMat newMat = (
  local n = 0
  for o in objects where o.material == oldMat do (
    o.material = newMat
    n = n + 1
  )
  n
)

fn exbSetParam k v = (
  local ok = false
  try ( FBXExporterSetParam k v; ok = true ) catch ( ok = false )
  ok
)

fn exbMapDirs = (
  local dirs = #()
  if maxFilePath != undefined and maxFilePath != "" then append dirs maxFilePath
  local cnt = 0
  try ( cnt = mapPaths.count() ) catch ( cnt = 0 )
  for k = 1 to cnt do (
    local p = undefined
    try ( p = mapPaths.get k ) catch ( p = undefined )
    if p != undefined and p != "" then append dirs p
  )
  try ( append dirs (getFilenamePath (getThisScriptFilename())) ) catch ()
  try ( append dirs (getDir #scene) ) catch ()
  dirs
)

fn exbIsGeometry o = (
  local r = false
  try ( r = isKindOf o GeometryClass ) catch ( r = false )
  r
)

/* Добавляет материал и всё, что вложено в Multi/Sub-Object. */
fn exbAddMat mat out depth = (
  if mat == undefined or depth > 5 then return out
  local exists = false
  try ( exists = (findItem out mat) > 0 ) catch ( exists = false )
  if exists then return out
  append out mat
  if (exbClass mat) == "multimaterial" then (
    local n = 0
    try ( n = mat.materialList.count ) catch ( n = 0 )
    for i = 1 to n do (
      local sub = undefined
      try ( sub = mat.materialList[i] ) catch ( sub = undefined )
      exbAddMat sub out (depth + 1)
    )
  )
  out
)

/* Все материалы сцены: обходом объектов (getClassInstances Material
   в этой сцене вернул 0 - вероятно из-за Blocks/контейнеров). */
fn exbSceneMats = (
  local out = #()
  for o in objects do (
    local m = undefined
    try ( m = o.material ) catch ( m = undefined )
    if m != undefined then exbAddMat m out 1
  )
  local all = #()
  try ( all = getClassInstances Material ) catch ( all = #() )
  for m in all do exbAddMat m out 1
  out
)

/* Создаёт каталог, если его нет. Возвращает true при успехе. */
fn exbEnsureDir dir = (
  if dir == undefined or dir == "" then return false
  local d = dir
  if d.count > 0 and (substring d d.count 1) == "\\" then d = substring d 1 (d.count - 1)
  if doesFileExist d then return true
  local ok = false
  try ( makeDir d all:true; ok = doesFileExist d ) catch ( ok = false )
  ok
)

/* ==================== ОСНОВНАЯ ЧАСТЬ ==================== */
(
  local t0 = timeStamp()
  local maxVerNum = 0
  try ( maxVerNum = (maxVersion())[1] ) catch ( maxVerNum = 0 )
  exbSay ("3ds Max версия: " + ((maxVerNum / 1000) as string))

  -- ---------- 1. ЕДИНИЦЫ (только чтение!) ----------
  -- НИЧЕГО НЕ МЕНЯЕМ. Любая запись в units.SystemType / MetricType
  -- меняет то, как экспортёр FBX объявляет единицы файла, и сцена
  -- приезжает в Blender в 10 раз крупнее (проверено на 5_2 и 5_3).
  local unitInfo = "?"
  try (
    local st = units.SystemType as string
    local ss = units.SystemScale as string
    local dt = units.DisplayType as string
    local mt = "?"
    try ( mt = units.MetricType as string ) catch ( mt = "-" )
    unitInfo = st + " x " + ss + ", отображение " + dt + "/" + mt
  ) catch ( unitInfo = "не прочитать" )
  exbSay ("[1] Единицы (не меняются): " + unitInfo)

  -- ---------- 2. ОБОЛОЧКА ДОМА И ОТСЕВ МУСОРА ----------
  -- Ищем по ОБЪЁМУ габарита: у стен это 148 x 95 x 30 = 420 тыс.,
  -- у плоского "Block" 148 x 433 x 0 - ноль, поэтому он больше не
  -- может случайно стать "домом" (так было в v3 -> фильтр отключился).
  local houseObj = undefined
  local bestVol = 0.0
  local geoCount = 0
  for o in objects do (
    if exbIsGeometry o then (
      geoCount = geoCount + 1
      local sz = o.max - o.min
      local vol = (abs sz.x) * (abs sz.y) * (abs sz.z)
      if vol > bestVol then (
        bestVol = vol
        houseObj = o
      )
    )
  )
  exbSay ("[2] Геометрии в сцене: " + (geoCount as string))

  local exportSet = #()
  local excluded  = #()
  if houseObj != undefined then (
    local keepMin = houseObj.min
    local keepMax = houseObj.max
    local cCenter = (keepMin + keepMax) / 2.0
    local limit = (length (keepMax - keepMin)) * EXB_FAR_FACTOR
    local hsz = keepMax - keepMin
    exbSay ("[2] Оболочка дома: " + houseObj.name + " | габарит " + (hsz as string))
    for o in objects do (
      local c = (o.min + o.max) / 2.0
      if (distance c cCenter) > limit then append excluded o else append exportSet o
    )
  ) else (
    exbSay "[2] Оболочка не найдена, фильтр по удалённости выключен."
    exportSet = for o in objects collect o
  )
  exbSay ("[2] Объектов всего " + (objects.count as string) + "; к выгрузке " + (exportSet.count as string) + "; исключено " + (excluded.count as string))
  local shown = 0
  for o in excluded while shown < 25 do (
    exbSay ("      исключён: " + o.name)
    shown = shown + 1
  )
  if EXB_DELETE_FAR and excluded.count > 0 then (
    local delN = excluded.count
    try (
      delete excluded
      exbSay ("[2] Удалено объектов: " + (delN as string))
    ) catch (
      exbSay "[2] Удалить не удалось, объекты только исключены."
    )
  )
  clearSelection()
  if exportSet.count > 0 then (
    try ( unfreeze exportSet ) catch ()
    try ( unhide exportSet ) catch ()
    select exportSet
  )
  exbSay ("[2] Выделено фактически: " + ((selection as array).count as string))
  if (selection as array).count == 0 and exportSet.count > 0 then (
    exbSay "[2] ВНИМАНИЕ: не удалось выделить объекты (заморозка/скрытые слои/группы)."
  )

  -- ---------- 3. РАЗВОРАЧИВАЕМ ЦЕПОЧКИ КАРТ ----------
  local mats = exbSceneMats()
  exbSay ("[3] Материалов в сцене: " + (mats.count as string))

  local flatN = 0
  if EXB_FLATTEN then (
    for mat in mats do (
      local n = 0
      try ( n = getNumSubTexmaps mat ) catch ( n = 0 )
      local i = 1
      while i <= n do (
        local slot = undefined
        try ( slot = getSubTexmap mat i ) catch ( slot = undefined )
        if slot != undefined and (not (exbIsBitmap slot)) then (
          local bm = exbDeepBitmap slot 1
          if bm != undefined then (
            try ( setSubTexmap mat i bm; flatN = flatN + 1 ) catch ()
          )
        )
        i = i + 1
      )
    )
    exbSay ("[3] Слотов, в которые поставлена настоящая карта: " + (flatN as string))
  )

  -- ---------- 4. ПУТИ К ТЕКСТУРАМ ----------
  if EXB_REPAIR then (
    local dirs = exbMapDirs()
    local fixedN = 0
    local missN = 0
    local seen = 0
    local okN = 0
    for mat in mats do (
      local n = 0
      try ( n = getNumSubTexmaps mat ) catch ( n = 0 )
      local i = 1
      while i <= n do (
        local s = undefined
        try ( s = getSubTexmap mat i ) catch ( s = undefined )
        if s != undefined and (exbIsBitmap s) then (
          seen = seen + 1
          local fname = ""
          try ( fname = s.filename ) catch ( fname = "" )
          if fname != undefined and fname != "" and (doesFileExist fname) then okN = okN + 1
          if fname != undefined and fname != "" and (not doesFileExist fname) then (
            local justName = filenameFromPath fname
            local found = undefined
            local k = 1
            while k <= dirs.count and found == undefined do (
              local cand = (dirs[k] as string)
              if cand.count > 0 and (substring cand cand.count 1) != "\\" then cand = cand + "\\"
              cand = cand + justName
              if doesFileExist cand then found = cand
              k = k + 1
            )
            if found != undefined then (
              try ( s.filename = found; fixedN = fixedN + 1 ) catch ()
            ) else (
              missN = missN + 1
            )
          )
        )
        i = i + 1
      )
    )
    exbSay ("[4] Битмап-карт в материалах: " + (seen as string) + "; файл на диске есть: " + (okN as string) + "; восстановлено путей: " + (fixedN as string) + "; не найдено: " + (missN as string))
    if seen == 0 then (
      exbSay "    ВНИМАНИЕ: битмап-карт не найдено вообще - текстуры в FBX не попадут."
    ) else (
      if (okN + fixedN) == 0 then (
        exbSay "    ВНИМАНИЕ: ни один файл текстуры не найден на диске - FBX будет без картинок."
        exbSay "    Проверьте External File Paths (Customize -> Configure User Paths) и пути в Asset Tracking."
      ) else (
        exbSay ("    Картинок, доступных для вшивания: " + ((okN + fixedN) as string) + " (остальное решит Blender).")
      )
    )
  )

  -- ---------- 5. ЧЁРНЫЙ ЦВЕТ ПРИ НАЛИЧИИ КАРТЫ ----------
  local blackN = 0
  if EXB_FIX_BLACK then (
    for mat in mats do (
      local hasMap = false
      local n = 0
      try ( n = getNumSubTexmaps mat ) catch ( n = 0 )
      local i = 1
      while i <= n do (
        local s = undefined
        try ( s = getSubTexmap mat i ) catch ( s = undefined )
        if s != undefined then hasMap = true
        i = i + 1
      )
      if hasMap then (
        for pn in #("diffuse", "colorDiffuse", "base_color", "diffuseColor") do (
          local c = exbGetProp mat pn
          if c != undefined and (isKindOf c Color) then (
            if (c.r < 12) and (c.g < 12) and (c.b < 12) then (
              if exbSetProp mat pn (color 235 235 235) then blackN = blackN + 1
            )
          )
        )
      )
    )
    exbSay ("[5] Материалов с исправленным чёрным цветом: " + (blackN as string))
  )

  -- ---------- 6. КОНВЕРТАЦИЯ В PHYSICAL MATERIAL ----------
  local convN = 0
  local thirdN = 0
  if EXB_CONVERT then (
    for mat in mats do (
      if exbIsThirdParty mat then (
        thirdN = thirdN + 1
        local pm = exbMaterialToPhysical mat
        if pm != undefined then (
          exbSwapMaterial mat pm
          try (
            local parents = for m in mats where (exbClass m) == "multimaterial" collect m
            for p in parents do (
              for i = 1 to p.materialList.count do (
                if p.materialList[i] == mat then p.materialList[i] = pm
              )
            )
          ) catch ()
          convN = convN + 1
        )
      )
    )
    exbSay ("[6] Материалов Corona/V-Ray найдено: " + (thirdN as string) + "; конвертировано в Physical: " + (convN as string))
  )

  -- ---------- 7. UVW ДЛЯ ОБЪЕКТОВ БЕЗ РАЗВЁРТКИ ----------
  local uvN = 0
  if EXB_ADD_UVW then (
    for o in objects do (
      if exbIsGeometry o then (
        local hasUV = false
        try (
          for m in o.modifiers while (not hasUV) do (
            local cn = exbClass m
            if (findItem #("uvwmap", "unwrap_uvw", "uvw_xform", "projection") cn) > 0 then hasUV = true
          )
        ) catch ()
        local anyMap = false
        if o.material != undefined then (
          local n = 0
          try ( n = getNumSubTexmaps o.material ) catch ( n = 0 )
          if n > 0 then anyMap = true
        )
        if (not hasUV) and anyMap then (
          try (
            local uv = UVWMap()
            uv.maptype = 4
            addModifier o uv
            uvN = uvN + 1
          ) catch ()
        )
      )
    )
    exbSay ("[7] Добавлено UVWMap(Box): " + (uvN as string))
  )

  -- ---------- 8. КОПИЯ СЦЕНЫ ----------
  try (
    if maxFilePath != undefined and maxFilePath != "" then (
      local baseName = maxFileName
      while (findString (toLower baseName) "prepared_") == 1 do (
        baseName = substring baseName 10 (baseName.count - 9)
      )
      local prep = maxFilePath + "prepared_" + baseName
      saveMaxFile prep quiet:true
      exbSay ("[8] Копия сцены: " + prep)
    ) else (
      exbSay "[8] У сцены нет пути - сохраните вручную."
    )
  ) catch ( exbSay "[8] Копию сохранить не удалось." )

  -- ---------- 9. КОНТРОЛЬНЫЙ РЕНДЕР ----------
  if EXB_PREVIEW then (
    try (
      local cams = for c in objects where (isKindOf c Camera) collect c
      if cams.count > 0 then (
        local f = EXB_OUT_DIR + "preview_from_max.png"
        render camera:cams[1] outputfile:f vfb:false outputwidth:EXB_PREVIEW_RES outputheight:EXB_PREVIEW_RES
        exbSay ("[9] Контрольный рендер: " + f)
      ) else (
        exbSay "[9] Камер нет, рендер пропущен."
      )
    ) catch ( exbSay "[9] Рендер не удался." )
  )

  -- ---------- 10. ЭКСПОРТ FBX ----------
  local dirOk = exbEnsureDir EXB_OUT_DIR
  if dirOk then (
    exbSay ("[10] Каталог выгрузки существует: " + EXB_OUT_DIR)
  ) else (
    exbSay ("[10] ВНИМАНИЕ: не удалось создать " + EXB_OUT_DIR + ", проверьте права.")
  )

  -- ConvertUnit НЕ трогаем: из-за него FBX ушёл в 100 раз крупнее.
  local p1 = exbSetParam "Cameras" true
  local p2 = exbSetParam "Lights" true
  local p3 = exbSetParam "SmoothingGroups" true
  local p4 = exbSetParam "EmbedTextures" true
  local p5 = exbSetParam "GenerateLog" true
  local p6 = exbSetParam "Triangulate" false
  exbSay ("[10] Параметры FBX: Cameras=" + (p1 as string) + " Lights=" + (p2 as string) + " Smoothing=" + (p3 as string) + " EmbedTextures=" + (p4 as string) + " Log=" + (p5 as string) + " Triangulate_off=" + (p6 as string))

  local outFile = EXB_OUT_DIR + EXB_OUT_NAME
  local exported = false
  local errMsg = ""
  try (
    exportFile outFile #noPrompt selectedOnly:EXB_SELECTED using:FBXEXP
    exported = true
  ) catch ( exported = false; errMsg = "FBXEXP: " + (getCurrentException()) )
  if not exported then (
    try (
      exportFile outFile #noPrompt selectedOnly:EXB_SELECTED
      exported = true
    ) catch ( exported = false; errMsg = "generic: " + (getCurrentException()) )
  )

  if exported and (doesFileExist outFile) then (
    local sz = 0
    try ( sz = (getFileSize outFile) / 1048576.0 ) catch ( sz = 0 )
    if sz > 0.001 then (
      exbSay ("[10] FBX выгружен: " + outFile)
      exbSay ("     размер файла: " + (sz as string) + " МБ")
    ) else (
      exbSay ("[10] ОШИБКА: FBX создан, но весит 0 байт: " + outFile)
      exbSay "     Причина чаще всего: пустой selectedOnly. Проверьте выделение (§2)."
    )
  ) else (
    exbSay "[10] ЭКСПОРТ НЕ УДАЛСЯ."
    if errMsg != "" then exbSay ("     " + errMsg)
    exbSay "     Проверьте EXB_OUT_DIR (двойные слеши!), права на запись и выделение."
  )

  -- ---------- ПРОВЕРКА МАСШТАБА ----------
  try (
    local ws = houseObj.max - houseObj.min
    local mPerUnit = 0.01
    local st = units.SystemType
    if st == #Millimeters then mPerUnit = 0.001
    if st == #Centimeters then mPerUnit = 0.01
    if st == #Meters      then mPerUnit = 1.0
    if st == #Inches      then mPerUnit = 0.0254
    if st == #Feet        then mPerUnit = 0.3048
    local wm = (abs ws.x) * mPerUnit
    local hm = (abs ws.y) * mPerUnit
    local zm = (abs ws.z) * mPerUnit
    exbSay ("[!] КОНТРОЛЬ МАСШТАБА: габарит оболочки = " + (ws as string) + " системных единиц")
    exbSay ("     это " + (wm as string) + " x " + (hm as string) + " x " + (zm as string) + " м")
    exbSay "     В Blender ровно такой габарит должен получиться при импорте с global_scale=0.1"
    exbSay "     (скрипт import_apartment.py подбирает масштаб сам)."
  ) catch ()

  -- ---------- ОТЧЁТ ----------
  exbSay ("Итого время: " + ((timeStamp() - t0) / 1000.0) as string + " сек.")

  local rf = EXB_OUT_DIR + "export_report.txt"
  local wrote = false
  try (
    local s = undefined
    try ( s = openEncodedFile rf mode:#write encoding:#utf8 ) catch ( s = undefined )
    if s == undefined then s = createFile rf
    if s != undefined then (
      for l in EXB_LOG do format "%\n" l to:s
      close s
      wrote = true
    )
  ) catch ( wrote = false )
  if not wrote then (
    try (
      rf = (getDir #temp) + "\\export_report.txt"
      local s = undefined
      try ( s = openEncodedFile rf mode:#write encoding:#utf8 ) catch ( s = undefined )
      if s == undefined then s = createFile rf
      if s != undefined then (
        for l in EXB_LOG do format "%\n" l to:s
        close s
        wrote = true
      )
    ) catch ( wrote = false )
  )
  if wrote then (
    format "\nОтчёт сохранён: %\n" rf
  ) else (
    format "\nОтчёт сохранить не удалось, смотрите Listener.\n"
  )
)