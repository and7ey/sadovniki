(
	-- ===================== НАСТРОЙКИ =====================
	local scenePath      = "C:\\temp\\5_1.max"
	local outDir         = "C:\\temp\\renders"
	local res            = 900
	local azimuthOffsets = #(-40, -20, 0, 20, 40)
	local elevations     = #(55, 45, 38, 32)
	local keepDistance   = true
	local renderExisting = true
	local sweepAll       = false
	local sweepCameraName = ""
	-- =====================================================

	fn sgn v = (
		if v >= 0 then ("+" + ((v as integer) as string)) else ((v as integer) as string)
	)

	fn safeName s = (
		local r = substituteString s " " "_"
		r = substituteString r "/" "_"
		r = substituteString r "\\" "_"
		r
	)

	fn floorPivot cam = (
		local view = -normalize (cam.transform.row3)
		local t = 60.0
		if (abs view.z) > 0.0001 and view.z < 0 then t = -cam.position.z / view.z
		if t < 0.001 or t > 100000.0 then t = 60.0
		cam.position + view * t
	)

	fn pivotOf cam = (
		if cam.target != undefined then cam.target.position else floorPivot cam
	)

	fn aimAt nd pos targetPos = (
		local z = normalize (pos - targetPos)
		local up = [0,0,1]
		if (abs (dot z up)) > 0.999 then up = [0,1,0]
		local x = normalize (cross up z)
		local y = cross z x
		nd.transform = matrix3 x y z pos
	)

	fn camAngles cam p = (
		local v = cam.position - p
		local horiz = sqrt (v.x*v.x + v.y*v.y)
		#(radToDeg (atan2 v.y v.x), radToDeg (atan2 v.z horiz))
	)

	fn placeCam cam origPos p azDeg elDeg keepDist = (
		local v = origPos - p
		local horiz = sqrt (v.x*v.x + v.y*v.y)
		local dist  = length v
		local azR = degToRad azDeg
		local elR = degToRad elDeg
		local newR = horiz
		local newH = horiz * (tan elR)
		if keepDist then (
			newR = dist * (cos elR)
			newH = dist * (sin elR)
		)
		local np = p + [newR * (cos azR), newR * (sin azR), newH]
		cam.position = np
		if cam.target == undefined then aimAt cam np p
		np
	)

	fn writeSheet path html = (
		local f = createFile path
		if f != undefined then (
			format "%" html to:f
			close f
			true
		) else false
	)

	if (not doesFileExist scenePath) then (
		print ("НЕТ ФАЙЛА СЦЕНЫ: " + scenePath)
	) else (
		if (not doesFileExist outDir) then makeDir outDir

		local loaded = loadMaxFile scenePath quiet:true useFileUnits:true
		if loaded != true then (
			print ("НЕ УДАЛОСЬ ОТКРЫТЬ СЦЕНУ: " + scenePath)
		) else (
			print ("Сцена открыта: " + scenePath)
			print ("Разрешение рендера: " + (res as string) + " x " + (res as string))

			local cams = #()
			for c in cameras do append cams c
			print ("Найдено камер: " + (cams.count as string))
			for i = 1 to cams.count do (
				local t = "нет цели"
				if cams[i].target != undefined then t = cams[i].target.name
				print ("  [" + (i as string) + "] " + cams[i].name + "  (" + ((classOf cams[i]) as string) + ", цель: " + t + ")")
			)

			if cams.count == 0 then (
				print "В сцене не найдено ни одной камеры — рендерить нечем."
			) else (
				local targetCam = cams[1]
				if sweepCameraName != "" then (
					for c in cams where c.name == sweepCameraName do targetCam = c
				)

				local html = ""
				html = html + "<!doctype html><html><head><meta charset='utf-8'><title>Renders</title>"
				html = html + "<style>body{background:#111;color:#eee;font:13px -apple-system,Segoe UI,sans-serif;margin:16px}"
				html = html + "figure{display:inline-block;margin:0 10px 18px 0;vertical-align:top}"
				html = html + "img{width:420px;height:420px;object-fit:contain;background:#000;border:1px solid #333}"
				html = html + "figcaption{padding-top:6px;text-align:center;color:#9ab}</style></head><body>"
				html = html + "<h2>Сцена: " + scenePath + "</h2>"

				local count = 0
				local t0 = timestamp()

				for cam in cams do (
					local p = pivotOf cam
					local ang = camAngles cam p
					local origPos = cam.position
					local sn = safeName cam.name
					print ("--- Камера " + cam.name + ": азимут " + (ang[1] as string) + "°, наклон " + (ang[2] as string) + "°")

					if renderExisting then (
						local f = outDir + "\\" + "cam_" + sn + "_as-is.png"
						render camera:cam frame:(currentTime.frame) outputfile:f outputwidth:res outputheight:res vfb:off
						count += 1
						html = html + "<figure><img src='" + ("cam_" + sn + "_as-is.png") + "'><figcaption>" + cam.name + " — как есть</figcaption></figure>"
						print ("    сохранено: " + f)
					)

					if (sweepAll or cam == targetCam) then (
						for a in azimuthOffsets do (
							for e in elevations do (
								placeCam cam origPos p (ang[1] + a) e keepDistance
								local fname = "cam_" + sn + "_az" + (sgn a) + "_el" + ((e as integer) as string) + ".png"
								local f = outDir + "\\" + fname
								render camera:cam frame:(currentTime.frame) outputfile:f outputwidth:res outputheight:res vfb:off
								count += 1
								html = html + "<figure><img src='" + fname + "'><figcaption>" + (sgn a) + "° / " + ((e as integer) as string) + "°</figcaption></figure>"
								print ("    сохранено: " + fname)
							)
						)
						cam.position = origPos
						if cam.target == undefined then aimAt cam origPos p
					)
				)

				html = html + "</body></html>"
				writeSheet (outDir + "\\index.html") html

				local secs = ((timestamp() - t0) / 1000.0) as integer
				print ("ГОТОВО. Кадров: " + (count as string) + ", время: " + (secs as string) + " c.")
				print ("Папка: " + outDir)
				print ("Обзор всех кадров: " + outDir + "\\index.html")
			)
		)
	)
)
