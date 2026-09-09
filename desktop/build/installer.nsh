; RetainPDF 自定义 NSIS 逻辑（electron-builder 默认加载 build/installer.nsh）
;
; 背景：升级/重装时，旧版的 rust_api.exe 可能因安装时应用未关闭、异常退出等原因
; 残留并继续监听 41000/42000，导致新版桌面端启动时报"端口已被占用"。
; 在安装器初始化阶段主动结束残留的 rust_api 进程，从源头避免该问题。
; 主程序 RetainPDF.exe 的运行检测由 electron-builder 自带逻辑处理，这里不重复。

!macro customInit
  ; 无匹配进程时 taskkill 返回非零，nsExec 忽略错误码，不影响安装流程
  nsExec::ExecToLog 'taskkill /F /IM rust_api.exe'
  ; 给端口释放留出时间，避免安装完成后首次启动仍看到端口占用
  Sleep 1000
!macroend
