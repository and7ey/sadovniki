/* ==================================================================
   export_for_blender.ms   v2
   Подготовка сцены 3ds Max и выгрузка FBX для Blender.

   ИСПРАВЛЕНО ПО ЛОГУ ПЕРВОГО ЗАПУСКА (3ds Max 2027 + Corona):
     - "Объект-стены не найден": класс геометрии в MaxScript называется
       GeometryClass, а не Geometry. Теперь ищется по габариту (площади
       следа), а не по имени.
     - "поставлена настоящая карта 0 / конвертировано 0": Corona-карты
       имеют класс CoronaBitmap (а не Bitmaptex), поэтому проверка
       "это битмап" теперь ищет подстроку "bitmap" в имени класса.
       Материалы Corona/V-Ray определяются по подстроке в имени класса.
     - УБРАН параметр ConvertUnit: из-за него FBX выходил в 100 раз
       больше (стены 148 м вместо 14.8 м).
     - Параметры экспорта теперь логируются: видно, какие Max принял.
     - Копия сцены больше не накапливает префиксы prepared_.

   ЧТО ДЕЛАЕТ:
     1. Единицы: системные сантиметры, отображение в метрах.
     2. Находит объект-оболочку дома по наибольшей площади следа и
        исключает из выгрузки всё, что стоит далеко (плиты соседних
        квартир и т.п.). Ничего не удаляет, если DELETE_FAR = false.
     3. Разворачивает цепочки процедурных карт: если в слоте лежит
        обёртка (Color Correction, MultiMap, GlossyConversion,
        CoronaAdaption, Falloff...), ставит в слот первую настоящую
        битмап-карту из цепочки. Главная причина пустых текстур в FBX.
     4. Чинит пути к текстурам.
     5. Чёрный базовый цвет при наличии карты -> белый
        (иначе карта умножается на ноль: чёрные шторы/зеркала).
     6. Конвертирует Corona/V-Ray материалы в Physical Material
        (базовая карта, шероховатость, металл, нормаль, прозрачность),
        включая вложенные в Multi/Sub-Object.
     7. UVWMap(Box) объектам без развёртки.
     8. Копия сцены prepared_<имя>.max.
     9. (опция) контрольный рендер из камеры.
    10. Экспорт FBX: Embed Media, камеры, свет, сглаживание; в отчёт
        пишется габарит стен для проверки масштаба.
    11. Отчёт export_report.txt рядом с FBX.

   КАК ЗАПУСКАТЬ: Scripting -> Run Script... (или перетащить .ms в окно).
   В путях обязательны двойные обратные слеши: "C:\\Users\\...\\"
   ================================================================== */

global EXB_OUT_DIR      = "C:\\Users\\lluky\\Desktop\\3D\\5\\"
global EXB_OUT_NAME     = "5_1_blender.fbx"
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
  try ( cnt = mapPaths.count ) catch ( cnt = 0 )
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

/* ==================== ОСНОВНАЯ ЧАСТЬ ==================== */
(
  local t0 = timeStamp()
  local maxVerNum = 0
  try ( maxVerNum = (maxVersion())[1] ) catch ( maxVerNum = 0 )
  exbSay ("3ds Max версия: " + ((maxVerNum / 1000) as string))

  -- ---------- 1. ЕДИНИЦЫ ----------
  local okUnits = false
  try (
    units.SystemType  = #Centimeters
    units.SystemScale = 1.0
    units.DisplayType = #Metric
    units.MetricType  = #Meters
    okUnits = true
  ) catch ( okUnits = false )
  if okUnits then (
    exbSay "[1] Единицы: системные сантиметры, отображение - метры."
  ) else (
    exbSay "[1] Единицы изменить не удалось."
  )

  -- ---------- 2. ОБОЛОЧКА ДОМА И ОТСЕВ МУСОРА ----------
  local houseObj = undefined
  local bestArea = 0.0
  local geoCount = 0
  for o in objects do (
    if exbIsGeometry o then (
      geoCount = geoCount + 1
      local sz = o.max - o.min
      local area = (abs sz.x) * (abs sz.y)
      if area > bestArea then (
        bestArea = area
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
    try (
      delete excluded
      exbSay ("[2] Удалено объектов: " + (excluded.count as string))
    ) catch (
      exbSay "[2] Удалить не удалось, объекты только исключены."
    )
  )
  clearSelection()
  if exportSet.count > 0 then select exportSet

  -- ---------- 3. РАЗВОРАЧИВАЕМ ЦЕПОЧКИ КАРТ ----------
  local mats = #()
  try ( mats = getClassInstances Material ) catch ( mats = #() )
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
    for mat in mats do (
      local n = 0
      try ( n = getNumSubTexmaps mat ) catch ( n = 0 )
      local i = 1
      while i <= n do (
        local s = undefined
        try ( s = getSubTexmap mat i ) catch ( s = undefined )
        if s != undefined and (exbIsBitmap s) then (
          seen = seen + 1
          local fn = ""
          try ( fn = s.filename ) catch ( fn = "" )
          if fn != undefined and fn != "" and (not doesFileExist fn) then (
            local justName = filenameFromPath fn
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
    exbSay ("[4] Битмап-карт в материалах: " + (seen as string) + "; восстановлено путей: " + (fixedN as string) + "; не найдено: " + (missN as string))
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
            local parents = for m in (getClassInstances Material) where (exbClass m) == "multimaterial" collect m
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
  -- ВАЖНО: параметры единиц (ConvertUnit) НЕ трогаем: из-за него FBX
  -- ушёл в 100 раз крупнее. Оставляем системные установки сцены.
  local p1 = exbSetParam "Cameras" true
  local p2 = exbSetParam "Lights" true
  local p3 = exbSetParam "SmoothingGroups" true
  local p4 = exbSetParam "EmbedTextures" true
  local p5 = exbSetParam "GenerateLog" true
  local p6 = exbSetParam "Triangulate" false
  exbSay ("[10] Параметры FBX: Cameras=" + (p1 as string) + " Lights=" + (p2 as string) + " Smoothing=" + (p3 as string) + " EmbedTextures=" + (p4 as string) + " Log=" + (p5 as string) + " Triangulate_off=" + (p6 as string))

  local outFile = EXB_OUT_DIR + EXB_OUT_NAME
  local exported = false
  try (
    exportFile outFile #noPrompt selectedOnly:EXB_SELECTED using:FBXEXP
    exported = true
  ) catch ( exported = false )
  if not exported then (
    try (
      exportFile outFile #noPrompt selectedOnly:EXB_SELECTED
      exported = true
    ) catch ( exported = false )
  )
  if exported then (
    exbSay ("[10] FBX выгружен: " + outFile)
    try (
      local sz = (getFileSize outFile) / 1048576.0
      exbSay ("     размер файла: " + (sz as string) + " МБ")
    ) catch ()
  ) else (
    exbSay "[10] ЭКСПОРТ НЕ УДАЛСЯ. Проверьте EXB_OUT_DIR (двойные слеши!) и права на запись."
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
    exbSay "     Именно такой габарит должен получиться в Blender после импорта."
    exbSay "     Если в Blender вышло в 100 раз больше - в диалоге FBX снимите галку Units/Convert Units."
  ) catch ()

  -- ---------- ОТЧЁТ ----------
  exbSay ("Итого время: " + ((timeStamp() - t0) / 1000.0) as string + " сек.")
  try (
    local rf = EXB_OUT_DIR + "export_report.txt"
    local s = createFile rf
    for l in EXB_LOG do format "%\n" l to:s
    close s
    format "\nОтчёт сохранён: %\n" rf
  ) catch (
    format "\nОтчёт сохранить не удалось, смотрите Listener.\n"
  )
)
