# id chip.ai / Pockit Engineers Diagnostic Engine V1.0
# Launched BY the webapp backend (hidden, no console window). Reports live
# progress after every stage so the technician's browser shows real status,
# not a simulated timer, then posts the final result into the session.

param(
 [Parameter(Mandatory=$true)][string]$SessionId,
 [string]$BackendUrl = "http://localhost:4000",
 [string]$Complaint = "",
 [string]$Category = "",
 [switch]$StressTest
)

$ErrorActionPreference="SilentlyContinue"
$base=Split-Path -Parent $MyInvocation.MyCommand.Path
$errors=New-Object System.Collections.Generic.List[string]
$checks=New-Object System.Collections.Generic.List[object]
$liveFindings=New-Object System.Collections.Generic.List[object]
$logFile=Join-Path $base "pockit-last-run.log"
function Log($msg){ try{ Add-Content -Path $logFile -Value "$(Get-Date -Format 'HH:mm:ss')  $msg" }catch{} }

function Progress($percent,$stage,$message){
 try{
  $liveFindings.Add([PSCustomObject]@{At=(Get-Date).ToString("o");Stage=$stage;Text=$message})
  $body=[ordered]@{Percent=$percent;Stage=$stage;Message=$message;Findings=@($liveFindings.ToArray())}|ConvertTo-Json -Depth 10
  Invoke-RestMethod -Uri "$BackendUrl/api/sessions/$SessionId/progress" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ErrorAction Stop -TimeoutSec 5 | Out-Null
 }catch{ Log "Progress POST failed: $($_.Exception.Message)" }
}

function Safe($name,$scriptBlock){
 try{& $scriptBlock}catch{$errors.Add("$name : $($_.Exception.Message)");$null}
}
function AddCheck($area,$status,$confidence,$value,$details){
 $checks.Add([PSCustomObject]@{Area=$area;Status=$status;Confidence=$confidence;Value=$value;Details=$details;CheckedAt=(Get-Date).ToString("o")})
}
function BatterySnapshot{
 # Cheap/fast fields only - called repeatedly (baseline + 7x during the 60s
 # AC test). Capacity/health/cycle count are a separate one-time lookup
 # (BatteryHealthReport) since they don't change within that window and the
 # method that gets them is far from free.
 $b=@(Safe "Battery" {Get-CimInstance Win32_Battery|Select-Object Name,Status,EstimatedChargeRemaining,BatteryStatus,Chemistry,DesignVoltage})
 [PSCustomObject]@{Time=(Get-Date).ToString("o");Battery=$b;ChargePercent=if($b.Count){$b[0].EstimatedChargeRemaining}else{$null};BatteryStatusCode=if($b.Count){$b[0].BatteryStatus}else{$null}}
}
function BatteryHealthReport{
 # root\wmi's BatteryStaticData/BatteryFullChargedCapacity/BatteryCycleCount
 # classes were found to require administrator rights on a real test machine
 # (they returned nothing for a standard user, silently, not because the
 # hardware lacks the data). `powercfg /batteryreport` is Microsoft's own
 # battery reporting tool, runs fine as a standard user, and has the same
 # design/full-charge capacity and cycle count in its HTML output - verified
 # against the same machine where the WMI classes came back empty.
 $result=[ordered]@{DesignCapacitymWh=$null;FullChargeCapacitymWh=$null;HealthPercent=$null;CycleCount=$null;Chemistry=$null}
 try{
  $tmp=Join-Path $env:TEMP "pockit-battery-report-$SessionId.html"
  powercfg /batteryreport /output $tmp 2>&1 | Out-Null
  if(Test-Path $tmp){
   $html=Get-Content $tmp -Raw -ErrorAction Stop
   if($html-match'DESIGN CAPACITY</span></td><td>([\d,]+) mWh'){$result.DesignCapacitymWh=[int]($matches[1]-replace',','')}
   if($html-match'FULL CHARGE CAPACITY</span></td><td>([\d,]+) mWh'){$result.FullChargeCapacitymWh=[int]($matches[1]-replace',','')}
   if($html-match'CYCLE COUNT</span></td><td>(\d+)'){$result.CycleCount=[int]$matches[1]}
   if($html-match'CHEMISTRY</span></td><td>([^<]+)'){$result.Chemistry=$matches[1].Trim()}
   if($result.DesignCapacitymWh-and$result.FullChargeCapacitymWh-and$result.DesignCapacitymWh-gt0){
    $result.HealthPercent=[math]::Round(($result.FullChargeCapacitymWh/$result.DesignCapacitymWh)*100,1)
   }
   Remove-Item $tmp -ErrorAction SilentlyContinue
  }
 }catch{$errors.Add("BatteryHealthReport : $($_.Exception.Message)")}
 [PSCustomObject]$result
}
function PowerSnapshot{
 $b=@(Safe "PowerBattery" {Get-CimInstance Win32_Battery|Select-Object Name,Status,EstimatedChargeRemaining,BatteryStatus})
 $acpi=Safe "ACPI" {Get-CimInstance -Namespace root\wmi -Class BatteryStatus|Select-Object -First 1}
 $scheme=Safe "PowerScheme" {powercfg /getactivescheme}
 [PSCustomObject]@{Time=(Get-Date).ToString("o");Battery=$b;ACPIBatteryStatus=$acpi;ActivePowerScheme="$scheme"}
}
function DellInfo{
 $cs=Safe "ComputerSystem" {Get-CimInstance Win32_ComputerSystem|Select-Object -First 1}
 $o=[ordered]@{DellDetected=$false;PowerServices=@();PowerDevices=@()}
 if($cs.Manufacturer-match"Dell"){
  $o.DellDetected=$true
  $o.PowerServices=@(Get-Service|?{$_.Name-match"Dell.*Power|Dell.*Battery"-or$_.DisplayName-match"Dell.*Power|Dell.*Battery"}|Select Name,DisplayName,Status,StartType)
  $o.PowerDevices=@(Get-CimInstance Win32_PnPEntity|?{$_.Name-match"Dell.*Power|Dell.*Battery|AC Adapter|ACPI.*Adapter"}|Select Name,Status,ProblemCode,Manufacturer,Class,PNPDeviceID)
 }
 [PSCustomObject]$o
}

function Run-StressTest($DurationSeconds=120){
 # Opt-in bounded active stress test: sustained CPU load across every logical
 # core + one disk write/read/hash-verify cycle. Hard duration cap; disk part
 # skipped entirely under 2GB free (never risk filling a nearly-full drive);
 # deliberately NO RAM-allocation test (a short checksum wouldn't meaningfully
 # prove memory integrity - would overstate what's verified). Always cleans up
 # the temp file and CPU workers, even on error.
 $result=[ordered]@{Requested=$true;DurationSeconds=$DurationSeconds;CpuCoresLoaded=$null;CpuCompleted=$false;DiskWriteVerifiedMB=$null;DiskCompleted=$false;DiskSkippedReason=$null;Errors=@();Finding=$null;Confidence=$null;Explanation=$null;CustomerMeaning=$null}
 $cores=[Environment]::ProcessorCount; $jobs=@()
 try{
  1..$cores|%{ $jobs+=Start-Job -ScriptBlock{ param($s) $sw=[System.Diagnostics.Stopwatch]::StartNew(); $x=1.0000001
   while($sw.Elapsed.TotalSeconds -lt $s){for($i=0;$i-lt200000;$i++){$x=[Math]::Sqrt($x)*1.0000001}} } -ArgumentList $DurationSeconds }
  $result.CpuCoresLoaded=$cores
 }catch{ $result.Errors+="CPU load failed: $($_.Exception.Message)" }
 $tempFile=Join-Path $env:TEMP "pockit-stress-$([guid]::NewGuid().ToString('N')).tmp"
 try{
  $freeGB=(Get-PSDrive -Name ($env:TEMP.Substring(0,1)) -ErrorAction Stop).Free/1GB
  if($freeGB -ge 2){
   $writeBytes=New-Object byte[] (200*1MB); (New-Object Random).NextBytes($writeBytes)
   [System.IO.File]::WriteAllBytes($tempFile,$writeBytes)
   $writeHash=(Get-FileHash -Path $tempFile -Algorithm SHA256).Hash
   $readHash=(Get-FileHash -InputStream ([System.IO.MemoryStream]::new([System.IO.File]::ReadAllBytes($tempFile))) -Algorithm SHA256).Hash
   $result.DiskWriteVerifiedMB=200; $result.DiskCompleted=($writeHash -eq $readHash)
   if(-not $result.DiskCompleted){$result.Errors+="Disk hash mismatch"}
  }else{ $result.DiskSkippedReason="Less than 2GB free - disk test skipped." }
 }catch{ $result.Errors+="Disk test failed: $($_.Exception.Message)" }
 finally{ if(Test-Path $tempFile){Remove-Item $tempFile -Force -ErrorAction SilentlyContinue} }
 if($jobs.Count){
  Wait-Job -Job $jobs -Timeout ($DurationSeconds+20) | Out-Null
  $result.CpuCompleted=(@($jobs|?{$_.State-eq"Completed"}).Count -eq $jobs.Count)
  if(@($jobs|?{$_.State-eq"Failed"}).Count){$result.Errors+="CPU worker(s) failed"}
  $jobs|Remove-Job -Force -ErrorAction SilentlyContinue
 }
 # Roll the raw results up into a Finding/Confidence/Explanation, matching the
 # battery/AC-test shape. A disk test that was attempted and mismatched is a
 # FAILED; a skip (low free space) is not a failure.
 $diskAttemptedFailed=(-not $result.DiskCompleted) -and ($null -eq $result.DiskSkippedReason)
 if($diskAttemptedFailed){
  $result.Finding="FAILED";$result.Confidence=90;$result.Explanation="A 200MB disk write/read/hash-verify cycle did not match - a possible storage integrity concern worth a closer look."
 }elseif(-not $result.CpuCompleted){
  $result.Finding="PARTIAL";$result.Confidence=60;$result.Explanation="The CPU load test did not complete cleanly across all $cores logical core(s) within the time limit."
 }else{
  $result.Finding="PASSED";$result.Confidence=85
  $result.Explanation="Sustained CPU load held across all $cores logical core(s) for $DurationSeconds seconds"+$(if($result.DiskSkippedReason){", and the disk test was skipped (low free space)."}else{", and a 200MB disk write/verify cycle passed."})
 }
 $result.CustomerMeaning="A short, bounded stress test - it briefly exercises the CPU and storage and cannot replace extended burn-in or reliably reproduce intermittent thermal/hardware faults."
 [PSCustomObject]$result
}

Log "Scan started for session $SessionId (backend $BackendUrl)"
Progress 4 "connecting" "Diagnostic agent connected to this PC."

$cs=Safe "ComputerSystem" {Get-CimInstance Win32_ComputerSystem|Select -First 1}
$os=Safe "OS" {Get-CimInstance Win32_OperatingSystem|Select -First 1}
$cpu=Safe "CPU" {Get-CimInstance Win32_Processor|Select -First 1}
$bios=Safe "BIOS" {Get-CimInstance Win32_BIOS|Select -First 1}
# Per-module manufacturer/speed for the report's Processor/RAM/Storage
# section - Win32_Processor.Name already includes clock speed for virtually
# every real CPU string (e.g. "Intel(R) Core(TM) i7-1165G7 @ 2.80GHz"), but
# RAM manufacturer/speed needs its own per-DIMM query since ComputerSystem
# only has the total.
$ramModules=@(Safe "RAM" {Get-CimInstance Win32_PhysicalMemory|Select Manufacturer,Capacity,Speed,PartNumber,DeviceLocator})

# Real hardware form factor (SMBIOS chassis type), not the technician's manual
# guess - used to decide what to emphasize (e.g. don't push battery info for
# a desktop) instead of assuming every PC is a laptop.
# Several checks (storage reliability counters, some battery WMI classes)
# silently return nothing without admin rights - not because the hardware
# lacks the data. We deliberately do NOT try to elevate: a UAC prompt cannot
# be hidden or suppressed, so elevating would break the "runs silently, no
# visible prompts" requirement this whole flow is built around. Instead we
# detect it and say so plainly rather than let it read as a hardware gap.
$isAdmin=$false
try{$isAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)}catch{}

$chassisTypes=@(Safe "Chassis" {(Get-CimInstance Win32_SystemEnclosure|Select -First 1).ChassisTypes})
$laptopCodes=@(8,9,10,11,14,30,31,32)
$desktopCodes=@(3,4,5,6,7,15,16,17,23,24,35,36)
$formFactor="Unknown"
if($chassisTypes){
 if(@($chassisTypes|?{$_-eq 13}).Count){$formFactor="All-in-One"}
 elseif(@($chassisTypes|?{$laptopCodes -contains $_}).Count){$formFactor="Laptop"}
 elseif(@($chassisTypes|?{$desktopCodes -contains $_}).Count){$formFactor="Desktop"}
}

$report=[ordered]@{
 SchemaVersion="1.0";GeneratedAt=(Get-Date).ToString("o");CollectionMode="WEBAPP_TRIGGERED"
 Machine=[ordered]@{Manufacturer=$cs.Manufacturer;Model=$cs.Model;ComputerName=$env:COMPUTERNAME;OS=$os.Caption;OSVersion=$os.Version;Build=$os.BuildNumber;Architecture=$os.OSArchitecture;RAM_GB=if($cs.TotalPhysicalMemory){[math]::Round($cs.TotalPhysicalMemory/1GB,1)}else{$null};RAMModules=@($ramModules|%{[ordered]@{Manufacturer=$(if($_.Manufacturer-and$_.Manufacturer-notmatch"^(Unknown|To Be Filled.*|0+)$"){$_.Manufacturer.Trim()}else{$null});CapacityGB=if($_.Capacity){[math]::Round($_.Capacity/1GB,0)}else{$null};SpeedMHz=$_.Speed;Slot=$_.DeviceLocator}});CPU=$cpu.Name;BIOS=$bios.SMBIOSBIOSVersion;SerialNumber=(Safe "BIOSSerial" {(Get-CimInstance Win32_BIOS).SerialNumber});FormFactor=$formFactor}
 AutomaticDiagnostics=[ordered]@{};Complaint=[ordered]@{Provided=$false;Description=$null;Category="None"};Checks=@();Summary=[ordered]@{};DiagnosticErrors=@()
}
Progress 8 "system" "$($cs.Manufacturer) $($cs.Model) - $($os.Caption)"

Log "[1/7] Performance"
$cpuS=@();$memS=@()
1..10|%{$p=Safe "CPU sample" {(Get-CimInstance Win32_Processor|Measure LoadPercentage -Average).Average};$m=Safe "RAM sample" {Get-CimInstance Win32_OperatingSystem};if($null-ne$p){$cpuS+=[double]$p};if($m-and$m.TotalVisibleMemorySize){$memS+=(1-($m.FreePhysicalMemory/$m.TotalVisibleMemorySize))*100};if($_-lt10){Start-Sleep 1}}
$cpuAvg=if($cpuS){[math]::Round(($cpuS|Measure -Average).Average,1)}else{$null};$cpuMax=if($cpuS){[math]::Round(($cpuS|Measure -Maximum).Maximum,1)}else{$null}
$memAvg=if($memS){[math]::Round(($memS|Measure -Average).Average,1)}else{$null};$memMax=if($memS){[math]::Round(($memS|Measure -Maximum).Maximum,1)}else{$null}
$perf="Good";if(($cpuMax-ge95)-or($memMax-ge95)){$perf="Attention"}elseif(($cpuAvg-ge80)-or($memAvg-ge85)){$perf="Watch"}
$topProcs=@(Safe "TopProcesses" {
 Get-Process|Sort WorkingSet64 -Descending|Select -First 15 Name,Id,CPU,WorkingSet64,Path|%{
  $sigStatus="PathUnavailable"
  if($_.Path){try{$sigStatus=(Get-AuthenticodeSignature -FilePath $_.Path -ErrorAction Stop).Status.ToString()}catch{$sigStatus="CheckFailed"}}
  [PSCustomObject]@{Name=$_.Name;Id=$_.Id;CPU=$_.CPU;WorkingSet64=$_.WorkingSet64;SignatureStatus=$sigStatus}
 }
})
$unsignedTop=@($topProcs|?{$_.SignatureStatus-eq"NotSigned"-or$_.SignatureStatus-eq"HashMismatch"})
$report.AutomaticDiagnostics.Performance=[ordered]@{CPUAveragePercent=$cpuAvg;CPUMaxPercent=$cpuMax;MemoryAveragePercent=$memAvg;MemoryMaxPercent=$memMax;TopMemoryProcesses=$topProcs}
AddCheck "Performance" $perf 90 "$cpuAvg% CPU avg / $memAvg% RAM avg" $(if($unsignedTop.Count){"Screening only. $($unsignedTop.Count) of the top resource-consuming processes are unsigned or fail signature verification - worth a look, though plenty of legitimate software is unsigned too."}else{"Screening only."})

$startup=@(Safe "Startup" {Get-CimInstance Win32_StartupCommand|Select Name,Command,Location,User})
$report.AutomaticDiagnostics.Startup=[ordered]@{Count=$startup.Count;Items=$startup}
$stStatus="Good";if($startup.Count-ge21){$stStatus="Attention"}elseif($startup.Count-ge11){$stStatus="Watch"}
AddCheck "Startup Programs" $stStatus 80 "$($startup.Count) program(s) set to launch at sign-in" "A high count is a common contributor to slow boot/sign-in, not a confirmed cause on its own - review the list with the customer for anything unrecognized or unwanted."
Progress 20 "performance" "CPU $cpuAvg% avg, RAM $memAvg% avg over 10s sample."

Log "[2/7] Storage"
$pd=@(Safe "Disks" {Get-PhysicalDisk|Select FriendlyName,HealthStatus,OperationalStatus,Size,MediaType,BusType,Manufacturer,Model,SerialNumber,FirmwareVersion})
$drive=Safe "SystemDrive" {Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"};$free=$null;if($drive-and$drive.Size){$free=[math]::Round($drive.FreeSpace/$drive.Size*100,1)}
$rel=@(Safe "Reliability" {Get-PhysicalDisk|Get-StorageReliabilityCounter|Select DeviceId,Temperature,PowerOnHours,Wear,PercentageUsed,ReadErrorsTotal,WriteErrorsTotal})
$st="Good";if(@($pd|?{$_.HealthStatus-match"Unhealthy|Critical"}).Count){$st="Attention"}elseif($free-lt10){$st="Watch"}
$report.AutomaticDiagnostics.Storage=[ordered]@{Physical=$pd;Reliability=$rel;ReliabilityUnavailableReason=$(if(!$rel.Count-and!$isAdmin){"Requires administrator rights"}elseif(!$rel.Count){"Not exposed by this drive/controller"}else{$null});SystemDrive=[ordered]@{FreePercent=$free;FreeGB=if($drive){[math]::Round($drive.FreeSpace/1GB,1)}else{$null};TotalGB=if($drive){[math]::Round($drive.Size/1GB,1)}else{$null}}}
$diskLabel=if($pd.Count){($pd|%{"$($_.MediaType) $($_.BusType) $($_.Size/1GB -as [int])GB"}) -join ', '}else{"no physical disk enumerated"}
AddCheck "Storage" $st 90 "$diskLabel - $free% system-drive free" $(if($rel.Count){"SMART/reliability counters read successfully."}elseif(!$isAdmin){"SMART temperature/wear/error counters need administrator rights to read - not run here, so not evaluated (not a sign the drive itself is unhealthy)."}else{"SMART/reliability counters not exposed by this drive or controller - varies by device."})
# Manufacturer/Model for the report's Processor/RAM/Storage section - added
# to Machine here (not earlier, alongside CPU/RAM) since it depends on $pd,
# which this Storage section is what collects it. Manufacturer is frequently
# blank, a generic placeholder ("(Standard disk drives)"), or - verified on
# a real NVMe drive - just echoes the bus type ("NVMe") rather than an
# actual brand; Model on the other hand often already includes the real
# brand AND the size (e.g. "BG6 KIOXIA 512GB"), so appending size again
# would duplicate it. Fall back to media/bus type only when neither field
# has anything real to offer.
$sizeAlreadyInModel={param($m)$m-and$m-match"\d+\s*(GB|TB)"}
$report.Machine.StorageModel=if($pd.Count){($pd|%{
 $parts=@($_.Manufacturer,$_.Model)|?{$_-and$_-notmatch"^(Unknown|\(Standard.*\)|NVMe|SATA|SCSI|ATA|USB|RAID)$"}
 if($parts.Count){$label=$parts-join" ";if(&$sizeAlreadyInModel $_.Model){$label}else{"$label $($_.Size/1GB -as [int])GB"}}
 else{"$($_.MediaType) $($_.BusType) $($_.Size/1GB -as [int])GB"}
})-join', '}else{$null}
Progress 34 "storage" "Storage: $st - $free% free on system drive."

Log "[3/7] Battery baseline"
$bat0=BatterySnapshot;$pow0=PowerSnapshot;$dell=DellInfo
$batHealth=if($bat0.Battery.Count){BatteryHealthReport}else{[PSCustomObject]@{DesignCapacitymWh=$null;FullChargeCapacitymWh=$null;HealthPercent=$null;CycleCount=$null;Chemistry=$null}}
$bat0|Add-Member -NotePropertyName DesignCapacitymWh -NotePropertyValue $batHealth.DesignCapacitymWh
$bat0|Add-Member -NotePropertyName FullChargeCapacitymWh -NotePropertyValue $batHealth.FullChargeCapacitymWh
$bat0|Add-Member -NotePropertyName HealthPercent -NotePropertyValue $batHealth.HealthPercent
$bat0|Add-Member -NotePropertyName CycleCount -NotePropertyValue $batHealth.CycleCount
$bat0|Add-Member -NotePropertyName Chemistry -NotePropertyValue $batHealth.Chemistry
$report.AutomaticDiagnostics.BatteryBaseline=$bat0;$report.AutomaticDiagnostics.PowerBaseline=$pow0;$report.AutomaticDiagnostics.DellPower=$dell
$bs="Good";if(!$bat0.Battery.Count){$bs="Unknown"}elseif($bat0.HealthPercent-ne$null-and$bat0.HealthPercent-lt60){$bs="Attention"}elseif($bat0.HealthPercent-ne$null-and$bat0.HealthPercent-lt80){$bs="Watch"}
AddCheck "Battery" $bs 90 $(if(!$bat0.Battery.Count){"No battery detected"}else{"$(if($bat0.ChargePercent-ne$null){"$($bat0.ChargePercent)%"}else{"unknown"}) charge; health $(if($bat0.HealthPercent){"$($bat0.HealthPercent)%"}else{"unknown"})"}) $(if(!$bat0.Battery.Count){"Expected on a desktop, or a laptop with the battery removed - not itself a fault."}elseif($bat0.HealthPercent){"Health = full-charge capacity ($($bat0.FullChargeCapacitymWh) mWh) / design capacity ($($bat0.DesignCapacitymWh) mWh), from Windows' own battery report ($($bat0.CycleCount) cycles)."}else{"Windows' battery report did not return capacity data on this run - not necessarily a hardware issue."})
Progress 46 "battery" "Battery: $(if($bat0.ChargePercent -ne $null){"$($bat0.ChargePercent)% charge"}else{"not detected"})$(if($bat0.HealthPercent){", health $($bat0.HealthPercent)%"})."

Log "[4/7] Device / driver health"
$dev=@(Safe "PnP" {Get-CimInstance Win32_PnPEntity|Select Name,Status,ConfigManagerErrorCode,Manufacturer,PNPClass,PNPDeviceID})
$drv=@(Safe "Drivers" {Get-CimInstance Win32_PnPSignedDriver|Select DeviceName,DriverProviderName,DriverVersion,DriverDate,IsSigned,DeviceClass})
$probs=@($dev|?{$_.ConfigManagerErrorCode-and$_.ConfigManagerErrorCode-ne0})
# ConfigManagerErrorCode 22 = "This device is disabled" - very commonly a
# deliberate user/IT-policy choice (unused Bluetooth, a webcam disabled by
# policy), not a fault. Every other nonzero code is a more genuine problem
# (won't start, driver missing/corrupt, resource conflict, etc).
$probsDisabled=@($probs|?{$_.ConfigManagerErrorCode-eq22})
$probsOther=@($probs|?{$_.ConfigManagerErrorCode-ne22})
$report.AutomaticDiagnostics.Drivers=[ordered]@{DeviceCount=$dev.Count;ProblemCount=$probs.Count;DisabledCount=$probsDisabled.Count;OtherProblemCount=$probsOther.Count;Problems=$probs;Drivers=$drv}
# Name the actual device(s) instead of just a count - "1 device with a
# problem code" tells a technician nothing they can act on; the device name
# and Device Manager error code do.
$probOtherNames=@($probsOther|%{"$($_.Name) (code $($_.ConfigManagerErrorCode))"})
$probOtherNamesStr=if($probOtherNames.Count-gt4){($probOtherNames[0..3]-join", ")+" +$($probOtherNames.Count-4) more"}else{$probOtherNames-join", "}
AddCheck "Drivers" $(if($probsOther.Count){"Attention"}elseif($probsDisabled.Count){"Watch"}else{"Good"}) 95 $(if($probsOther.Count){"$($probsOther.Count) device(s) reporting a real problem code"}elseif($probsDisabled.Count){"$($probsDisabled.Count) device(s) disabled"}else{"0 problem device(s)"}) $(if($probsOther.Count){"$probOtherNamesStr. "}else{""})$(if($probsDisabled.Count-and$probsOther.Count){"Plus $($probsDisabled.Count) disabled device(s) - commonly intentional (user or IT policy), not itself a fault."}elseif($probsDisabled.Count){"Disabled devices are commonly intentional (user or IT policy, e.g. an unused adapter or a webcam turned off) rather than a fault - worth a quick check, not automatically a problem."}else{"Device Manager problem codes."})
Progress 58 "drivers" "Drivers: $($dev.Count) devices enumerated, $($probs.Count) with problem codes."

Log "[5/7] Components / network"
$gpu=@(Safe "GPU" {Get-CimInstance Win32_VideoController|Select Name,Status,DriverVersion,DriverDate})
$aud=@(Safe "Audio" {Get-CimInstance Win32_SoundDevice|Select Name,Status,Manufacturer,PNPDeviceID})
$key=@(Safe "Keyboard" {Get-CimInstance Win32_Keyboard|Select Name,Status,PNPDeviceID})
$ptr=@(Safe "Pointing" {Get-CimInstance Win32_PointingDevice|Select Name,Manufacturer,Status,PNPDeviceID})
$usb=@($dev|?{$_.PNPClass-eq"USB"})
$cam=@($dev|?{$_.PNPClass-eq"Camera"-and$_.Name-notmatch"virtual|printer|scanner"})
$mon=@(Safe "Monitor" {Get-CimInstance Win32_DesktopMonitor|Select Name,ScreenWidth,ScreenHeight,Status,PNPDeviceID})
$touch=@($dev|?{$_.PNPClass-eq"HIDClass"-and$_.Name-match"touch\s*screen|digitizer"-and$_.Name-notmatch"touch\s*pad"})
$ad=@(Safe "NetworkAdapters" {Get-NetAdapter|Select Name,InterfaceDescription,Status,LinkSpeed,MacAddress})
$adPhysical=@($ad|?{$_.InterfaceDescription-notmatch"VirtualBox|VMware|Hyper-V|Virtual|TAP-|Npcap|Loopback|vEthernet"})
$net=Safe "Internet" {Test-NetConnection 1.1.1.1 -Port 443 -InformationLevel Detailed};$dns=Safe "DNS" {Resolve-DnsName www.microsoft.com -ErrorAction Stop|Select -First 1}
$report.AutomaticDiagnostics.Components=[ordered]@{GPU=$gpu;Monitors=$mon;TouchInput=$touch;CameraCandidates=$cam;Audio=$aud;Keyboard=$key;Pointing=$ptr;USB=$usb}
$report.AutomaticDiagnostics.Network=[ordered]@{Adapters=$ad;PhysicalAdapters=$adPhysical;InternetReachable=$net.TcpTestSucceeded;DNSResolution=($null-ne$dns)}
$gpuBad=@($gpu|?{$_.Status-and$_.Status-ne"OK"})
AddCheck "Display" $(if($gpuBad.Count){"Attention"}elseif($gpu.Count){"Detected"}else{"Unknown"}) $(if($gpuBad.Count){70}else{90}) $(if($gpuBad.Count){"$($gpuBad.Count) of $($gpu.Count) GPU(s) reporting a non-OK status"}else{"$($gpu.Count) GPU(s)"}) $(if($gpuBad.Count){"Windows reports a driver/hardware problem on this device: $($gpuBad|%{$_.Name+': '+$_.Status} -join '; '). On hybrid-graphics laptops (dual integrated+discrete GPU) a powered-down discrete GPU can also show a non-OK status with nothing wrong - verify before treating as a fault."}else{"Visual faults require user testing."})
$monBad=@($mon|?{$_.Status-and$_.Status-ne"OK"})
AddCheck "Monitor" $(if($monBad.Count){"Attention"}elseif($mon.Count){"Good"}else{"Unknown"}) 85 $(if($monBad.Count){"$($monBad.Count) of $($mon.Count) monitor(s) reporting a non-OK status"}elseif($mon.Count){"$($mon.Count) monitor(s) reporting OK"}else{"No monitor reported by Windows"}) $(if(!$mon.Count){"On a desktop this can mean the display cable is unplugged or the monitor is off - worth a physical check. On a laptop, Windows sometimes doesn't enumerate the built-in panel this way even though it's working; treat 'Unknown' as inconclusive, not a fault."}else{"Confirms Windows has a display output; does not test picture quality."})
AddCheck "Touch Input" $(if($touch.Count){"Detected"}else{"Unknown"}) 80 $(if($touch.Count){"Touchscreen/digitizer detected"}else{"No touchscreen detected"}) "Best-effort detection by device name; absence here does not rule out a non-standard touch digitizer. Not the trackpad - see Touchpad."
AddCheck "Camera" $(if($cam.Count){"Detected"}else{"Unknown"}) 90 $(if($cam.Count){"Camera detected ($($cam.Count) candidate device$(if($cam.Count-ne1){'s'}))"}else{"No camera device found by Windows"}) $(if($cam.Count){"Detection does not prove image quality; a functional test is still needed."}else{"Could be no built-in camera, a disabled/uninstalled driver, or a privacy switch - not necessarily a hardware fault."})
$audBad=@($aud|?{$_.Status-and$_.Status-ne"OK"})
AddCheck "Audio" $(if($audBad.Count){"Attention"}elseif($aud.Count){"Detected"}else{"Unknown"}) $(if($audBad.Count){70}else{90}) $(if($audBad.Count){"$($audBad.Count) of $($aud.Count) audio device(s) reporting a non-OK status"}else{"$($aud.Count) audio device(s)"}) $(if($audBad.Count){"Windows reports a driver/hardware problem on this device: $($audBad|%{$_.Name+': '+$_.Status} -join '; '). On a corporate-managed PC this can also mean a device disabled by Group Policy rather than a fault - verify before treating as a hardware issue."}else{"Detection does not prove playback/mic quality."})
AddCheck "Keyboard" $(if($key.Count){"Detected"}else{"Unknown"}) 90 "Keyboard detected ($($key.Count) Windows entr$(if($key.Count-eq1){'y'}else{'ies'}))" "Windows commonly reports one physical keyboard as more than one entry (e.g. an ACPI device plus a separate HID layer). This is entry count, not physical keyboard count. Not every key is tested."
AddCheck "Touchpad" $(if($ptr.Count){"Detected"}else{"Unknown"}) 90 "$($ptr.Count) pointing device(s)" "Device enumeration only; gestures not tested."
AddCheck "USB" $(if($usb.Count){"Detected"}else{"Unknown"}) 90 "$($usb.Count) USB controller/hub/device entr$(if($usb.Count-eq1){'y'}else{'ies'})" "Counts USB controllers, hubs and connected devices - not physical ports. An empty port shows up here only once something has been plugged into it, so this cannot confirm every port works."
AddCheck "Network" $(if($net.TcpTestSucceeded-and$dns){"Good"}else{"Watch"}) 90 "$($adPhysical.Count) physical adapter(s); Internet=$($net.TcpTestSucceeded); DNS=$($null-ne$dns)" "Point-in-time connectivity. Tests a direct connection to a public IP and hostname - on a network that requires a proxy or blocks direct external access by policy, this can report Watch even though the user's own internet access works fine. $(if($ad.Count-ne$adPhysical.Count){"$($ad.Count-$adPhysical.Count) virtual adapter(s) (VPN/VM software) excluded from the physical count above."})"
Progress 76 "components" "Display, camera, audio, keyboard, touchpad and USB enumerated. Network: $(if($net.TcpTestSucceeded){"connected"}else{"unreachable"})."

Log "[6/7] Complaint: $Complaint"
$problem=$Complaint.Trim()
if($problem){
 # Prefer the backend's AI-assisted classification (handles Hindi/Hinglish
 # and phrasing the regex below can't) when the webapp provided one; the
 # regex cascade is the always-available fallback if AI wasn't configured
 # or the complaint arrived some other way.
 if($Category){
  $cat=$Category
 }else{
  $cat="General"
  if($problem-match"batter|charg|adapter|power|ac "){$cat="Battery"}elseif($problem-match"wifi|wi-fi|wireless|internet|network|disconnect"){$cat="Network"}elseif($problem-match"slow|lag|freeze|hang|performance|hot|overheat"){$cat="Performance"}elseif($problem-match"screen|display|flicker|pixel|brightness|monitor"){$cat="Display"}elseif($problem-match"camera|webcam"){$cat="Camera"}elseif($problem-match"microphone|mic"){$cat="Microphone"}elseif($problem-match"speaker|sound|audio"){$cat="Audio"}elseif($problem-match"keyboard|key"){$cat="Keyboard"}elseif($problem-match"touchpad|trackpad|mouse|cursor"){$cat="Input"}elseif($problem-match"usb|pendrive"){$cat="USB"}elseif($problem-match"driver"){$cat="Drivers"}
 }
 $report.Complaint=[ordered]@{Provided=$true;Description=$problem;Category=$cat}
 if($cat-eq"Battery"){
  Log "Running 60s battery/AC test"
  Progress 78 "battery-test" "Starting 60-second battery/AC charging test."
  $samples=@()
  1..7|%{
   $b=BatterySnapshot;$p=PowerSnapshot
   $samples+=[PSCustomObject]@{Time=$b.Time;ChargePercent=$b.ChargePercent;BatteryStatusCode=$b.BatteryStatusCode;ACPIBatteryStatus="$($p.ACPIBatteryStatus)";FullChargeCapacitymWh=$bat0.FullChargeCapacitymWh;HealthPercent=$bat0.HealthPercent;CycleCount=$bat0.CycleCount}
   $elapsed=($_-1)*10
   Progress (78+[math]::Round($_*2.4)) "battery-test" "Charging test ${elapsed}s/60s - charge $($b.ChargePercent)%."
   if($_-lt7){Start-Sleep 10}
  }
  $first=$samples[0];$last=$samples[-1];$delta=$null;if($first.ChargePercent-ne$null-and$last.ChargePercent-ne$null){$delta=[int]$last.ChargePercent-[int]$first.ChargePercent}
  # Win32_Battery.BatteryStatus (per Microsoft's CIM_Battery/DMI mapping):
  # 1=discharging, 2=on AC but NOT necessarily charging, 3=fully charged,
  # 4=low, 5=critical, 6-9=charging variants, 11=partially charged.
  $codes=@($samples|%{$_.BatteryStatusCode}|?{$_-ne$null}|Select -Unique)
  $dischargingObserved=$codes -contains 1
  $acAmbiguousObserved=$codes -contains 2
  $fullObserved=$codes -contains 3
  $chargingObserved=@($codes|?{@(6,7,8,9) -contains $_}).Count -gt 0
  $finding="UNABLE_TO_DETERMINE";$confidence=40;$explanation="Insufficient Windows telemetry to determine charging state."
  if($delta-gt0){$finding="CHARGING_CONFIRMED";$confidence=95;$explanation="Battery percentage increased while the test ran."}
  elseif($delta-lt0){$finding="BATTERY_DISCHARGING_DURING_TEST";$confidence=90;$explanation="Battery percentage decreased during the test."}
  elseif($fullObserved-and$last.ChargePercent-ge95){$finding="FULL_OR_NEAR_FULL";$confidence=90;$explanation="Windows reported a fully-charged state."}
  elseif(($chargingObserved-or$acAmbiguousObserved)-and$delta-eq0){$finding="AC_CHARGING_STATE_REPORTED_BUT_PERCENTAGE_DID_NOT_INCREASE";$confidence=$(if($chargingObserved){80}else{65});$explanation=$(if($chargingObserved){"Windows reported an active charging state, but the coarse percentage did not rise during 60 seconds."}else{"AC power was detected but Windows did not report an active charging state either - ambiguous, not a confirmed charging failure on its own."}) + " If the charge level was already sitting at a round number like 50%/60%/80%, check whether a vendor battery-care / charge-threshold feature (common on Lenovo, Dell and HP business laptops) is intentionally capping charge to extend battery lifespan before treating this as a fault."}
  elseif($dischargingObserved-and$delta-eq0){$finding="NOT_CHARGING_OR_POWER_NOT_SUSTAINING_BATTERY";$confidence=75;$explanation="Windows reported discharging while the charger was supposed to be connected, and the percentage did not rise."}
  $report.AutomaticDiagnostics.ComplaintInvestigation=[ordered]@{
   Category="Battery";Complaint=$problem;InitialBattery=$bat0;InitialPower=$pow0;DellPower=$dell
   MonitoringSeconds=60;Samples=$samples;ChargeDeltaPercentagePoints=$delta
   ChargingStateObserved=$chargingObserved;DischargingStateObserved=$dischargingObserved;FullStateObserved=$fullObserved;ACPresentAmbiguousObserved=$acAmbiguousObserved
   Finding=$finding;Confidence=$confidence;Explanation=$explanation
   CustomerMeaning="This is a screening result. Adapter wattage, USB-C PD negotiation, DC jack condition and physical charger output may require hardware-specific or physical testing."
  }
  Progress 95 "battery-test" "Charging test result: $finding"
 }elseif($cat-eq"Network"){
  $report.AutomaticDiagnostics.ComplaintInvestigation=[ordered]@{Category=$cat;Adapters=$ad;Internet=$net.TcpTestSucceeded;DNS=($null-ne$dns)}
 }elseif($cat-eq"Performance"){
  $report.AutomaticDiagnostics.ComplaintInvestigation=[ordered]@{Category=$cat;TopMemoryProcesses=$report.AutomaticDiagnostics.Performance.TopMemoryProcesses;CPUAverage=$cpuAvg;CPUMax=$cpuMax;MemoryAverage=$memAvg;MemoryMax=$memMax}
 }else{
  $report.AutomaticDiagnostics.ComplaintInvestigation=[ordered]@{Category=$cat;AutomaticFollowUp="Specialized functional testing remains required for this complaint."}
 }
}

if($StressTest){
 Log "Extended stability test requested"
 Progress 97 "stress-test" "Running extended stability test (CPU + disk, up to ~2 min)."
 $stress=Run-StressTest 120
 $report.AutomaticDiagnostics.StressTest=$stress
 # A failed active test is a real, confirmed hardware signal - surface it as a
 # check so it counts toward the overall status and health score.
 if($stress.Finding-eq"FAILED"){AddCheck "Stability Test" "Attention" $stress.Confidence "Extended stability test failed" $stress.Explanation}
 elseif($stress.Finding-eq"PARTIAL"){AddCheck "Stability Test" "Watch" $stress.Confidence "Extended stability test partially completed" $stress.Explanation}
 else{AddCheck "Stability Test" "Good" $stress.Confidence "Extended stability test passed" $stress.Explanation}
 Progress 99 "stress-test" "Stability test: $($stress.Finding)"
}

Log "[7/7] Finalizing"
$report.Checks=$checks.ToArray()
$attention=@($checks|?{$_.Status-eq"Attention"}).Count;$watch=@($checks|?{$_.Status-eq"Watch"}).Count;$unknown=@($checks|?{$_.Status-eq"Unknown"}).Count
$overall="NO_IMMEDIATE_ISSUE_DETECTED";if($attention){$overall="NEEDS_ATTENTION"}elseif($watch){$overall="WATCH"}elseif($unknown){$overall="PARTIALLY_ASSESSED"}
$report.Summary=[ordered]@{Checks=$checks.Count;Attention=$attention;Watch=$watch;Unknown=$unknown;OverallStatus=$overall;CustomerProblemProvided=$report.Complaint.Provided;FunctionalTestsStillAvailable=@("Display","Camera","Microphone","Speaker","Keyboard","Touchpad","USB Port","Headphone")}
$report.DiagnosticErrors=$errors.ToArray()

Log "Scan complete, posting to $BackendUrl/api/sessions/$SessionId/complete"
try{
 $json = $report | ConvertTo-Json -Depth 20
 Invoke-RestMethod -Uri "$BackendUrl/api/sessions/$SessionId/complete" -Method Post -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -ErrorAction Stop | Out-Null
 Log "Posted successfully."
}catch{
 Log "FAILED to post results: $($_.Exception.Message)"
 try{
  $failBody = @{ error = "$($_.Exception.Message)" } | ConvertTo-Json
  Invoke-RestMethod -Uri "$BackendUrl/api/sessions/$SessionId/fail" -Method Post -ContentType "application/json" -Body $failBody -ErrorAction Stop | Out-Null
 }catch{}
}
