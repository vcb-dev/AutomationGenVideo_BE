-- Lark sync đã bị ngắt hoàn toàn (xem commit "fix(lark): ngắt kết nối đồng bộ với Lark").
-- Các bảng dưới đây không còn nhận dữ liệu từ Lark nữa mà là kho dữ liệu thật cho
-- checklist/traffic report/KPI trên web — đổi tên cho khớp vai trò thực tế, KHÔNG đổi dữ liệu.
ALTER TABLE "lark_reports" RENAME TO "checklist_reports";
ALTER TABLE "lark_kpi" RENAME TO "kpi";
ALTER TABLE "lark_kpi_do_da" RENAME TO "kpi_do_da";
ALTER TABLE "lark_kpi_global_indo" RENAME TO "kpi_global_indo";
ALTER TABLE "lark_kpi_do_da_editor" RENAME TO "kpi_do_da_editor";
ALTER TABLE "lark_traffic" RENAME TO "traffic_reports";
ALTER TABLE "lark_permissions" RENAME TO "report_permissions";
ALTER TABLE "lark_report_kpi" RENAME TO "report_kpi";
ALTER TABLE "lark_list_tasks" RENAME TO "reported_tasks";
