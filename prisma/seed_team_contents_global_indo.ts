/**
 * Seed team_contents cho team "Global - Indo" — nguồn: WINNING CONTENT GLOBAL VCB_DATABASE.csv
 * (đã import vào DB local ngày 2026-07-09, file này để chạy lại trên server).
 *
 * Chỉ map 2 field có sẵn trong bảng team_contents: title (cột CHỦ ĐỀ) và script
 * (cột KỊCH BẢN CHI TIẾT). Các cột khác trong CSV (ID, TUYẾN, LINK, NHÓM CHỦ ĐỀ,
 * Trạng thái, Các mục mẹ) không có field tương ứng nên bỏ qua.
 *
 * Team/User được match theo NAME/EMAIL (không hardcode UUID) vì id giữa local và
 * server không giống nhau (teams/team_members không được sync giữa 2 DB).
 *
 * Idempotent: bỏ qua title đã tồn tại sẵn cho team này, chạy lại nhiều lần an toàn.
 *
 * Cách chạy trên server:
 *   npx ts-node prisma/seed_team_contents_global_indo.ts
 *
 * Yêu cầu: biến môi trường DATABASE_URL trỏ đúng database server cần seed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEAM_NAME = 'Global - Indo';
const ADDED_BY_EMAIL = 'lenhngockhanh@gmail.com'; // leader team Global - Indo

const DATA: { title: string; script: string | null }[] = [
  {
    "title": "Mẹo đeo mặt dây chuyền bị chật",
    "script": null
  },
  {
    "title": "Tháo nhẫn chật bằng chỉ",
    "script": null
  },
  {
    "title": "Nhẫn bị mắc kẹt ở tay",
    "script": null
  },
  {
    "title": "Cắt nhẫn bằng dụng cụ chuyên dụng",
    "script": null
  },
  {
    "title": "Mẹo biến dây chuyền thành lắc tay",
    "script": null
  },
  {
    "title": "Đeo vòng tay không vừa",
    "script": null
  },
  {
    "title": "Tháo vòng tay bị chật",
    "script": null
  },
  {
    "title": "Đeo nhẫn vào dây chuyền",
    "script": null
  },
  {
    "title": "Cách đeo khóa chữ M",
    "script": null
  },
  {
    "title": "Mẹo đo size nhẫn tại nhà",
    "script": null
  },
  {
    "title": "Làm sạch trang sức bằng sóng siêu âm",
    "script": null
  },
  {
    "title": "Tổng hợp các mẹo trang sức",
    "script": null
  },
  {
    "title": "Đánh sáng trang sức tại nhà",
    "script": null
  },
  {
    "title": "Đánh Sáng Trang Sức Bạc",
    "script": null
  },
  {
    "title": "Đánh sáng trang sức vàng",
    "script": null
  },
  {
    "title": "Các kim loại quý hiếm",
    "script": null
  },
  {
    "title": "Vàng thật không sợ đen",
    "script": null
  },
  {
    "title": "Phân biệt vàng thật giả bằng âm thanh",
    "script": null
  },
  {
    "title": "Vàng có trong cơ thể",
    "script": null
  },
  {
    "title": "Top 10 sự thật về vàng",
    "script": null
  },
  {
    "title": "1 Ký vàng là bao nhiêu?",
    "script": null
  },
  {
    "title": "Vàng và các quốc gia",
    "script": null
  },
  {
    "title": "Đừng ai đòi làm trang sức vàng 100%",
    "script": null
  },
  {
    "title": "Vì sao những cô dâu sau cưới có thể bóp nát vàng",
    "script": null
  },
  {
    "title": "Các loại ngọc trai quý hiếm",
    "script": null
  },
  {
    "title": "Các loại đá quý",
    "script": null
  },
  {
    "title": "Đá quý đại diên cho các quốc gia",
    "script": null
  },
  {
    "title": "Vàng lá có ăn được không?",
    "script": null
  },
  {
    "title": "Vàng lá được sản xuất như thế nào",
    "script": null
  },
  {
    "title": "Tái chế vụn vàng",
    "script": null
  },
  {
    "title": "Nung chảy vàng và kim cương",
    "script": null
  },
  {
    "title": "Cho vàng vào axit sẽ có phản ứng gì",
    "script": null
  },
  {
    "title": "Ý nghĩa của 10 ngón tay đeo nhẫn",
    "script": null
  },
  {
    "title": "Tại sao đeo nhẫn cưới ở ngón úp út?",
    "script": null
  },
  {
    "title": "Chiếc nhẫn thần kỳ 2 trong 1",
    "script": null
  },
  {
    "title": "Đá quý đại diện cho các tháng sinh phần 1",
    "script": null
  },
  {
    "title": "Đá quý đại diện cho các tháng sinh phần 2",
    "script": null
  },
  {
    "title": "đá đại diện cho người sinh tháng 3",
    "script": "Bạn sinh vào tháng 3 không?\nÍt ai biết rằng Aquamarine – viên đá đại diện cho tháng 3 – từng được các thủy thủ mang theo như một lá bùa may mắn khi ra khơi.\nVới sắc xanh trong như nước biển, Aquamarine tượng trưng cho sự bình yên, lòng dũng cảm và sự chân thành.\nNgười xưa tin rằng viên đá này có thể bảo vệ họ trước những chuyến hải trình dài và mang lại sự thuận lợi trên biển.\nChính vì vậy, Aquamarine không chỉ là đá tháng sinh của tháng 3 mà còn là biểu tượng của sự bảo vệ và những khởi đầu tốt đẹp.\nBạn có sinh vào tháng 3 không? Hãy để lại tháng sinh của mình ở phần bình luận nhé."
  },
  {
    "title": "Kim cương thử lửa",
    "script": "1. [HOOK]\nAi cũng biết vàng thật không sợ lửa. Vậy còn kim cương thì sao? Liệu bỏ một viên kim cương trị giá hàng chục triệu vào lửa đốt thì nó có biến mất không? Xem hết clip này để biết câu trả lời nhé!\n2. [NEO EFFORT] & [GIÁ TRỊ]\nNhiều người làm thí nghiệm dùng khò gas đốt trực tiếp viên đá ở nhiệt độ cao. Ban đầu, viên đá đổi màu, nhưng khi nguội lại khôi phục độ trong suốt lung linh ban đầu, không hề bị nứt vỡ. Từ đó, ai cũng lầm tưởng kim cương cũng là \"bất tử\" trước lửa.\n3. [CẢNH BÁO] (Cú bẻ lái kiến thức - Điểm đắt giá nhất)\nNhưng HuyK cảnh báo anh em: Đừng bao giờ dại dột mang kim cương thật ra thử tại nhà! Bản chất kim cương là Cacbon. Nếu gặp ngọn lửa đủ lớn đạt tới khoảng 800°C trong môi trường có Oxy, viên kim cương của bạn sẽ cháy rụi hoàn toàn và bốc hơi biến thành khí $CO_2$, không còn lại một chút tro tàn nào đâu. Viên đá trong các clip thí nghiệm mà không bị cháy, phần lớn chỉ là đá giả hoặc đá giả lập CZ mà thôi!\n4. [USE CASE] & [CTA]\nBởi vậy, anh em nào đang có ý định \"thử lửa\" để kiểm tra kim cương thật giả thì dừng lại ngay trước khi quá muộn nhé, thử xong là mất luôn cả gia tài đấy.\nCác ông ở đây đã có ai từng tận mắt thấy kim cương bị đốt cháy thành không khí chưa? Bình luận xuống dưới cho HuyK biết với!"
  },
  {
    "title": "Trang sức vàng ở dubai",
    "script": null
  },
  {
    "title": "đá đại diện tháng 4",
    "script": "Ít ai biết rằng loại đá đại diện cho tháng 4 cũng là vật liệu tự nhiên cứng nhất trên Trái Đất.\nĐó chính là kim cương.\nKhông chỉ nổi tiếng bởi vẻ đẹp lấp lánh, kim cương còn tượng trưng cho sức mạnh, sự bền bỉ và tình yêu vĩnh cửu.\nCó lẽ vì vậy mà đây luôn là một trong những loại đá quý được yêu thích nhất trên thế giới.\nNếu sinh vào tháng 4, đây chính là viên đá mang ý nghĩa đặc biệt dành cho bạn.\nBạn có biết đá tháng sinh của mình là gì không?"
  },
  {
    "title": "fact về kim cương",
    "script": "Nhiều người nghĩ kim cương là thứ không thể bị hỏng.\nNhưng thực tế, kim cương không bất khả phá hủy.\nĐúng là kim cương có độ cứng cao nhất trong tự nhiên, giúp chống trầy xước rất tốt.\nTuy nhiên, độ cứng không đồng nghĩa với khả năng chịu va đập.\nNếu bị tác động mạnh đúng vị trí, kim cương vẫn có thể sứt mẻ hoặc thậm chí nứt vỡ.\nĐó cũng là lý do những món trang sức gắn kim cương vẫn cần được sử dụng và bảo quản cẩn thận.\nTrước đây bạn có nghĩ kim cương cũng có thể bị vỡ không?"
  },
  {
    "title": "đá đại diện tháng 5",
    "script": "Ít ai biết rằng loại đá đại diện cho tháng 5 từng xuất hiện trong bộ sưu tập của nhiều vị vua và nữ hoàng từ hàng ngàn năm trước.\nĐó chính là Emerald, hay còn gọi là ngọc lục bảo.\nVới màu xanh đặc trưng, loại đá này từ lâu đã tượng trưng cho sự phát triển, hy vọng và sức sống.\nCho đến ngày nay, Emerald vẫn là một trong những loại đá quý được yêu thích nhất trên thế giới.\nNếu sinh vào tháng 5, đây chính là viên đá tháng sinh mang ý nghĩa đặc biệt dành cho bạn.\nBạn thích Emerald hay kim cương hơn?"
  },
  {
    "title": "Mẹo đeo khoá chữ S",
    "script": "Gặp cướp giật cũng không lo mất vòng vàng nếu bạn biết mẹo khóa chữ S siêu dễ này!\nChuẩn bị một sợi dây nhỏ nhưng chắc chắn.\nLuồn sợi dây qua cả hai đầu chốt của khóa chữ S trên vòng tay.\nThắt nút thật chặt lại rồi cắt bỏ phần thừa là xong.\nBằng cách này, chiếc vòng sẽ được trói chặt yên vị trên tay, đảm bảo không bao giờ lo bị rơi hay tuột mất. Chị em nào sợ mất vàng thì lưu ngay video lại để áp dụng nhé!"
  },
  {
    "title": "dá quý đại diện tháng 6",
    "script": "bạn có biết rằng loại đá đại diện cho tháng 6 lại không được hình thành trong lòng đất.\nĐó chính là ngọc trai.\nKhác với hầu hết các loại đá quý khác, ngọc trai được tạo ra bên trong trai và hàu qua nhiều năm nó còn có cách gọi khác là đá quý hữu cơ.\nVới vẻ đẹp mềm mại và thanh lịch, ngọc trai từ lâu đã tượng trưng cho sự thuần khiết, trí tuệ và hạnh phúc.\nĐó cũng là lý do ngọc trai trở thành viên đá đại diện cho những người sinh vào tháng 6.\nbạn có biết đá quý đại diện cho tháng sinh của mình không?"
  },
  {
    "title": "Đá sinh mệnh tháng 4,5,6",
    "script": "[HOOK]\nBạn sinh vào tháng 4, 5 hay 6?\nVậy thì viên đá sinh mệnh đại diện cho bạn có thể còn đặc biệt hơn bạn nghĩ.\n[CHÀO MỪNG]\nChào mừng mọi người quay trở lại với chuỗi video về đá sinh mệnh – Phần 2.\nHôm nay chúng ta sẽ cùng khám phá những viên đá đại diện cho tháng 4, tháng 5 và tháng 6 nhé.\n[NEO EFFORT + GIÁ TRỊ]\n💎 Tháng 4 – Kim cương\nXin chúc mừng những người sinh tháng 4, bởi viên đá sinh mệnh của bạn chính là kim cương.\nKim cương là loại đá quý được yêu thích và ngưỡng mộ nhất trên thế giới.\nSở hữu độ cứng cao nhất trong tất cả các loại đá quý cùng vẻ đẹp lấp lánh rực rỡ, chỉ một viên nhỏ cũng đủ thu hút mọi ánh nhìn.\nTừ thời cổ đại, kim cương đã được xem là biểu tượng của sự trong sáng, sức mạnh và ý chí không thể bị phá vỡ.\n💚 Tháng 5 – Ngọc lục bảo\nBước sang tháng 5, viên đá sinh mệnh đại diện chính là ngọc lục bảo.\nĐây là biểu tượng của trí tuệ, may mắn và sự thịnh vượng.\nNgọc lục bảo là một trong những loại đá quý cao cấp không thể thiếu trong ngành chế tác trang sức trên thế giới.\nMàu xanh đặc trưng của nó tượng trưng cho sức sống mãnh liệt và đã mê hoặc con người suốt hàng ngàn năm qua.\n🌙 Tháng 6 – Ngọc trai, Alexandrite và Moonstone\nĐặc biệt hơn cả, những người sinh tháng 6 có tới ba loại đá sinh mệnh đại diện.\nĐó là ngọc trai với vẻ đẹp thanh lịch, Alexandrite nổi tiếng với khả năng đổi màu kỳ diệu và Moonstone mang ánh sáng dịu dàng đầy cuốn hút.\nVới ba lựa chọn này, bạn hoàn toàn có thể chọn viên đá phù hợp với phong cách và sở thích của riêng mình.\n[CTA]\nNếu mọi người có câu hỏi hoặc muốn tìm hiểu sâu hơn về đá sinh mệnh, hãy để lại bình luận bên dưới nhé.\nỞ phần tiếp theo, chúng ta sẽ cùng khám phá những viên đá đại diện cho các tháng còn lại."
  },
  {
    "title": "đá đại diện tháng 7",
    "script": "ai cũng biết đến ruby về độ quý hiếm và vẻ đẹp của nó nhưng viên đá này cũng \n là viên đá đại diện cho tháng 7.\nRuby, hay còn gọi là hồng ngọc, từ lâu đã tượng trưng cho đam mê, sức mạnh và may mắn.\nKhông chỉ được yêu thích bởi vẻ đẹp nổi bật, Ruby còn là một trong những loại đá quý có giá trị cao.\nNếu sinh vào tháng 7, đây chính là viên đá tháng sinh dành cho bạn.\nBạn có biết viên đá nào đại diện cho tháng sinh của mình không"
  },
  {
    "title": "đá sinh mệnh thg 8",
    "script": "Bạn sinh tháng 8?\n\nViên đá sinh mệnh đại diện cho bạn gần như chỉ có duy nhất một màu trong tự nhiên.\n\nĐó chính là Peridot.\n\nVới sắc xanh tươi sáng đặc trưng, Peridot từ lâu đã được xem là biểu tượng của may mắn, niềm vui và nguồn năng lượng tích cực.\n\nNhiều người cũng tin rằng loại đá này giúp mang lại sự tự tin và xua tan những cảm xúc tiêu cực.\n\nbạn có biết viên đá đại diện cho các tháng sinh còn lại không?"
  },
  {
    "title": "không đeo trang sức khi bơi",
    "script": null
  },
  {
    "title": "cách bảo quản vòng tay ngọc",
    "script": null
  },
  {
    "title": "Mẹo bảo vệ lắc tay không bị rơi",
    "script": null
  },
  {
    "title": "Mẹo kiểm tra bạc thật giả",
    "script": null
  },
  {
    "title": "Mẹo đánh bóng trang sức moissanite tại nhà",
    "script": null
  },
  {
    "title": "Nung vàng với bạc với nhau",
    "script": null
  },
  {
    "title": "Kim cương được tạo ra như thế nào",
    "script": null
  },
  {
    "title": "Viên kim cương lớn nhất thế giới",
    "script": null
  },
  {
    "title": "Chiếc dây chuyền khóa kéo độc lạ",
    "script": null
  },
  {
    "title": "Những loại khóa ít người biết tên",
    "script": null
  },
  {
    "title": "Màu sắc của kim cương nhân tạo có gì đặc biệt?",
    "script": null
  },
  {
    "title": "Ngọc không trao tay, vàng không rời mắt",
    "script": null
  },
  {
    "title": "Nhìn Khóa Đoán Giá Trị Trang Sức",
    "script": null
  },
  {
    "title": "Độ An Toàn Của Khóa Trang Sức",
    "script": null
  },
  {
    "title": "Các Loại Khóa Dây Chuyền Phổ Biến",
    "script": null
  },
  {
    "title": "đá sinh mệnh tháng 10",
    "script": null
  },
  {
    "title": "đá sinh mệnh tháng 9",
    "script": null
  },
  {
    "title": "mẹo xác định kích thước đá phù hợp với bản thân",
    "script": null
  },
  {
    "title": "đá sinh mệnh tháng 1,2,3",
    "script": null
  },
  {
    "title": "bạc kị những thứ này",
    "script": null
  },
  {
    "title": "đá sinh mệnh tháng 11",
    "script": null
  },
  {
    "title": "4 loại dây chuyền vàng dễ đứt tốn tiền",
    "script": null
  },
  {
    "title": "Đặt trang sức vàng lên đá",
    "script": null
  },
  {
    "title": "Vì sao phụ nữ nên đeo nhiều vàng",
    "script": null
  },
  {
    "title": "đá sinh mệnh tháng 12",
    "script": null
  },
  {
    "title": "Đá Moissanite có phải là kim cương hay không?",
    "script": null
  },
  {
    "title": "Dây chuyền khóa kéo độc lạ",
    "script": null
  },
  {
    "title": "Bảo vệ vòng tay",
    "script": null
  },
  {
    "title": "Tại sao nhẫn kim cương được xem là vật đính ước?",
    "script": null
  },
  {
    "title": "Có thật là chỉ kim cương mới cắt được kim cương?",
    "script": null
  },
  {
    "title": "Trang sức của những phú bà Trung Quốc có gì đặc biệt?",
    "script": null
  },
  {
    "title": "Có nên mua vàng 24K để đeo trang sức mỗi ngày?",
    "script": null
  },
  {
    "title": "Ngọc Trai giả",
    "script": null
  },
  {
    "title": "Thủy Ngân Ăn Vàng",
    "script": null
  },
  {
    "title": "Phân biệt bạc thật giả tại nhà",
    "script": null
  },
  {
    "title": "BẠN CÓ BIẾT RẰNG VÀNG TINH KHIẾT NHẤT THỰC RA LẠI QUÁ MỀM ĐỂ CHẾ TẠO THÀNH TRANG SỨC?",
    "script": null
  },
  {
    "title": "CÁC LOẠI VÀNG CÓ NHỮNG ĐIỂM KHÁC BIỆT LÀ GÌ?",
    "script": null
  },
  {
    "title": "Vàng dẻo như thế nào",
    "script": null
  },
  {
    "title": "Test vàng thật giả bằng lửa",
    "script": null
  },
  {
    "title": "Vàng có thể bị gỉ sét không?",
    "script": null
  },
  {
    "title": "Vàng được hình thành như nào",
    "script": null
  },
  {
    "title": "Các loại kim lại quý hiếm",
    "script": null
  },
  {
    "title": "So sánh sự khác biệt của bạc và bạch kim",
    "script": null
  },
  {
    "title": "Phân biệt bạc s999 và s925",
    "script": null
  },
  {
    "title": "Tại sao đeo vòng bạc bị đen tay",
    "script": null
  },
  {
    "title": "Phân biệt kim cương thật giả",
    "script": null
  },
  {
    "title": "Quy trình xử lý kim cương thô",
    "script": null
  },
  {
    "title": "Sự thật về kim cương khi mới khai thác",
    "script": null
  },
  {
    "title": "Hổ phách được hình thành như nào",
    "script": null
  },
  {
    "title": "Thu gom vụn vàng sau chế tác",
    "script": null
  },
  {
    "title": "Kỹ thuật khảm đá quý trong nghề kim hoàn",
    "script": null
  },
  {
    "title": "Máy chỉnh kích thước nhẫn",
    "script": null
  },
  {
    "title": "Ý nghĩa cái tên lắc tay tennis",
    "script": null
  },
  {
    "title": "Vòng tay ngọc xoắn",
    "script": null
  },
  {
    "title": "Tại sao tổng biên tập thời trang lớn nhất TG chỉ đeo duy nhất 1 chiếc dây chuyền",
    "script": null
  },
  {
    "title": "Thương hiệu Châu Đại Phúc",
    "script": null
  },
  {
    "title": "Lừa đảo vàng giả",
    "script": null
  },
  {
    "title": "Thạch anh tóc vàng",
    "script": null
  },
  {
    "title": "kim cương khi bị nung",
    "script": "Bạn nghĩ điều gì xảy ra khi đốt một viên kim cương bằng đèn khò?\nNhiều người cho rằng nó sẽ nóng chảy.\nNhưng kim cương thực sự rất khó nóng chảy.\nĐiều bất ngờ là trong môi trường có đủ oxy, kim cương có thể bắt đầu cháy ở nhiệt độ khoảng 850 đến 1.000 độ C.\nVì được cấu tạo từ carbon nguyên chất, nó sẽ phản ứng với oxy và tạo thành khí co2\nĐiều đó có nghĩa là viên kim cương có thể dần biến mất vào không khí.\nNghe khó tin, nhưng đôi khi kim cương cháy trước khi kịp nóng chảy.\nTrước đây bạn nghĩ kim cương có thể nóng chảy không?"
  },
  {
    "title": "Tại sao không bán trang sức bạc 100%?",
    "script": "Tại sao gần như không có trang sức làm từ bạc 100%? Nhiều người nghĩ rằng hàm lượng bạc càng tinh khiết thì chất lượng càng tốt. Nhưng thực tế lại không hẳn như vậy. Bạc nguyên chất rất mềm. Hàm lượng bạc càng cao thì càng dễ bị móp méo, trầy xước, thậm chí biến dạng trong quá trình sử dụng hằng ngày. Ví dụ như mẫu nhẫn xoay của tôi này. Rất nhiều người muốn đặt làm bằng bạc 100% hoặc bạc 999 vì cho rằng như vậy sẽ cao cấp hơn. Nhưng tôi luôn từ chối. Tại sao? Bởi vì mẫu nhẫn này có rất nhiều chi tiết nhỏ và cơ chế xoay. Nếu sử dụng loại bạc quá mềm thì nhẫn rất dễ bị biến dạng và phần xoay cũng sẽ không bền theo thời gian. Đó là lý do phần lớn trang sức hiện nay sử dụng bạc S925. Vì loại bạc này vẫn chứa 92,5% bạc nguyên chất nhưng có độ cứng và độ bền tốt hơn, phù hợp để đeo hằng ngày. Vì vậy, nếu có nơi quảng cáo bán trang sức bạc 100%, đừng vội tin ngay. Hãy tìm hiểu kỹ thông tin trước khi quyết định. Còn bạn thì sao, bạn sẽ chọn bạc S925 hay bạc 999? Hãy để lại ý kiến ở phần bình luận nhé!"
  },
  {
    "title": "Phong cách trang sức ở các quốc gia",
    "script": "https://v.douyin.com/xGh2-C4NdAM/"
  },
  {
    "title": "Người phụ nữ đeo ngọc trai đẹp nhất thế giới?",
    "script": null
  },
  {
    "title": "phân biệt vàng trăng và bạch kim",
    "script": "99% mọi người thường nhầm bạch kim với vàng trắng. Nhưng thực tế, đây là hai loại kim loại hoàn toàn khác nhau. Bạch kim là kim loại quý tự nhiên với độ tinh khiết cao và màu trắng xám đặc trưng. Trong khi đó, vàng trắng là vàng nguyên chất được pha thêm các kim loại khác để tạo màu sáng hơn. Trong nghề kim hoàn, chúng tôi gặp rất nhiều khách hàng nghĩ rằng hai loại này là một. cách để phân biệt là vàng trắng thường được phủ thêm một lớp Rhodium để tăng độ sáng bóng. Sau một thời gian sử dụng, lớp phủ này bị mòn đi, khiến trang sức ngả màu nhẹ. Còn bạch kim vẫn giữ được màu sắc tự nhiên theo thời gian. Bạn có từng nghĩ bạch kim và vàng trắng là một không?"
  },
  {
    "title": "Sàng Lọc Đá Quý Bằng Mắt Thường",
    "script": null
  },
  {
    "title": "hàn the",
    "script": null
  },
  {
    "title": "quá trình khai thác vàng",
    "script": null
  },
  {
    "title": "phân biệt cz và kim cương",
    "script": null
  },
  {
    "title": "kim cương được tạo ra từ lông chó",
    "script": null
  },
  {
    "title": "Kim loại Bismuth",
    "script": null
  },
  {
    "title": "Lịch sử Graff Diamonds",
    "script": null
  },
  {
    "title": "Tại sao vàng lại có màu vàng?",
    "script": "Tại sao vàng lại có màu vàng? đây là câu hỏi đơn giản nhưng không phải ai cũng trả lời được. Nguyên nhân nằm ở cấu trúc nguyên tử của vàng. Nói đơn giản, các electron trong nguyên tử vàng chuyển động rất nhanh nên vàng hấp thụ mạnh ánh sáng xanh lam và phản xạ chủ yếu ánh sáng vàng, đỏ. Chính điều đó tạo nên màu vàng đặc trưng mà chúng ta nhìn thấy. Là người làm kim hoàn, mình vẫn luôn thấy thú vị khi màu sắc của một món trang sức lại bắt nguồn từ những quy luật vật lý ở cấp độ nguyên tử. Bạn có biết ngoài vàng còn kim loại nào có màu đặc trưng như vậy không?"
  },
  {
    "title": "bát nung của thợ kim hoàn",
    "script": null
  },
  {
    "title": "pha lê thực chất là thủy tinh",
    "script": null
  },
  {
    "title": "nung kim loại sẽ như thế nào",
    "script": null
  },
  {
    "title": "đá tạp chất chưa chắc đã kém chất lượng",
    "script": null
  },
  {
    "title": "Phỉ Thúy ở Trung Quốc đặc biệt như thế nào?",
    "script": null
  },
  {
    "title": "HuyK so sánh 2 lắc tay thiên long thật giả",
    "script": null
  },
  {
    "title": "Chia sẻ khó khăn khi làm trang sức",
    "script": "Nhiều người nghĩ nghề kim hoàn chỉ đơn giản là gắn đá lên nhẫn rồi hoàn thành.\n\nNhưng thực tế lại khác rất nhiều.\n\nCó những viên đá chỉ lệch một chút cũng phải tháo ra làm lại.\nCó những chiếc nhẫn phải trải qua hơn 20 công đoạn khác nhau trước khi hoàn thiện. \n\n\n\nBởi chỉ cần một sai lệch nhỏ, thành phẩm sẽ không còn hoàn hảo như mong muốn.\n\nĐó là lý do chúng tôi luôn kiểm tra từng chi tiết trước khi một món trang sức được hoàn thiện.\n\nVới tôi, trang sức không chỉ là thứ để đeo.\n\nNó có thể là món quà cho người mình yêu.\n\nMột lời cầu hôn.\n\nHay một dấu mốc đặc biệt trong cuộc đời.\n\nVà khi biết sản phẩm ấy sẽ đồng hành cùng những khoảnh khắc quan trọng của ai đó...\n\nTôi luôn cảm thấy mọi công sức bỏ ra đều hoàn toàn xứng đáng. ✨\n\nBạn có từng sở hữu một món trang sức mang ý nghĩa đặc biệt với mình không?"
  },
  {
    "title": "Người bạn đá quý đặc biệt của HuyK",
    "script": "Bạn có từng nhìn thấy đôi bàn tay nào như thế này chưa? Thoạt nhìn, nó có vẻ đáng sợ. Những ngón tay biến dạng, làn da dày cộm và đầy những vết chai sạn. Đây là David, một người săn tìm đá quý đến từ Slovakia. Ông đã đi qua hơn 25 quốc gia trên thế giới và dành phần lớn cuộc đời mình để làm việc với đá. Khoảng 4 năm trước, David từng tham gia cuộc chiến tại Ukraine. Ông đã sống sót sau một vết thương nghiêm trọng và sau đó quyết định dành phần đời còn lại để theo đuổi niềm đam mê lớn nhất của mình: tìm kiếm những viên đá quý đẹp nhất trên thế giới. Những đôi tay này chính là minh chứng cho điều đó. Hàng chục năm tiếp xúc với đá, bụi đá và những công việc nặng nhọc đã để lại dấu vết trên cơ thể ông. Khi gặp nhau, tôi và David đã có rất nhiều câu chuyện để chia sẻ. Tôi kể cho ông nghe về nghề chế tác trang sức. Còn ông kể cho tôi nghe về những chuyến đi, những vùng đất và những viên đá quý mà ông từng tìm thấy. Lần này, David đến Việt Nam vì một lý do đặc biệt. Ông đang tìm kiếm Sapphire xanh coban – một trong những loại đá quý hiếm nhất của Việt Nam. Một viên đá nhỏ chỉ bằng hạt đậu nhưng đôi khi có giá trị hơn cả một chiếc xe sang. Trước khi rời đi, tôi đã tặng David một món quà nhỏ. Và hy vọng rằng trong dự án đặc biệt sắp tới, chúng tôi sẽ lại có cơ hội đồng hành cùng nhau. Còn bây giờ, hãy chúc cho hành trình săn tìm đá quý của David sẽ luôn bình an nhé."
  },
  {
    "title": "chuyện mua bán cho học sinh 2",
    "script": null
  },
  {
    "title": "chuyên mua bán cho học sinh",
    "script": null
  },
  {
    "title": "Chiếc nhẫn tự thiết kế",
    "script": "G001 - Chiếc nhẫn tự thiết kế"
  },
  {
    "title": "Không ngờ làm được sản phẩm như vậy",
    "script": "002. Không ngờ làm được sản phẩm như vậy"
  },
  {
    "title": "Không ai muốn nhẫn không thương hiệu",
    "script": "G003 - Không ai muốn 1 chiếc nhẫn không có thương hiệu"
  },
  {
    "title": "Dành nhiều tâm huyết",
    "script": "G004 - Dành nhiều tâm huyết"
  },
  {
    "title": "Quy trình chế tác",
    "script": "G005 - Quy trình chế tác"
  },
  {
    "title": "Hối hận khi thiết kế",
    "script": "G006 - Hối hận khi thiết kế"
  },
  {
    "title": "10 năm trong nghề",
    "script": "G007 - 10 năm trong nghề"
  },
  {
    "title": "Tại sao trang sức thủ công có giá như vậy",
    "script": "G008 - Tại sao trang sức thủ công có giá như vậy?"
  },
  {
    "title": "Từng thề không làm",
    "script": "G009 - Từng thề không làm"
  },
  {
    "title": "Tâm sự nghề",
    "script": "G010 - Tâm sự nghề"
  },
  {
    "title": "Tâm sự nghề 2",
    "script": "G011 - Tâm sự nghề 2"
  },
  {
    "title": "Chiếc nhẫn giới thiệu lần trước",
    "script": "G012. Chiếc nhẫn giới thiệu lần trước (Nối tiếp dùng chung)"
  },
  {
    "title": "Cảm ơn khách hàng",
    "script": "G013. Cảm ơn khách hàng (Nối tiếp dùng chung)"
  },
  {
    "title": "Mẫu nhẫn được yêu thích nhất",
    "script": "G014. Mẫu nhẫn được yêu thích nhất (Nối tiếp dùng chung)"
  },
  {
    "title": "Doanh số bán nhiều",
    "script": "G015. Doanh số bán nhiều (Nối tiếp dùng chung)"
  },
  {
    "title": "Phát triển sản phẩm mới",
    "script": "G016. Phát triển sản phẩm mới (Nối tiếp dùng chung)"
  },
  {
    "title": "Không nhớ là chiếc thứ bao nhiêu",
    "script": "G017. Không nhớ là chiếc thứ bao nhiêu (Nối tiếp dùng chung)"
  },
  {
    "title": "Sản phẩm bị lãng quên",
    "script": "G018. Sản phẩm bị cũ (Nối tiếp dùng chung)"
  },
  {
    "title": "Món quà tặng người thân",
    "script": "G019 - Món quà tặng người thân"
  },
  {
    "title": "Từ chối vì không có thương hiệu",
    "script": "G020 - Từ chối vì không có thương hiệu"
  },
  {
    "title": "Thử thách của khách hàng",
    "script": "G021 - Thử thách của khách hàng"
  },
  {
    "title": "Nối tiếp món quà tặng người thân",
    "script": "G022 - Nối tiếp Món quà tặng người thân"
  },
  {
    "title": "Nối tiếp Thử thách của khách hàng",
    "script": "G023 - Nối tiếp Thử thách của khách hàng"
  },
  {
    "title": "Nối tiếp chiếc nhẫn tự thiết kế",
    "script": "G024 - Nối tiếp Chiếc nhẫn tự thiết kế"
  },
  {
    "title": "SỐ lượng đặt hàng - Nối tiếp Phát triển sản phẩm",
    "script": "G025 - Số lượng đặt hàng - Nối tiếp Phát triển sản phẩm mới"
  },
  {
    "title": "Nối tiếp Từng thề không làm",
    "script": "G026 - Nối tiếp Từng thề không làm"
  },
  {
    "title": "Nhẫn tàng hình",
    "script": "G027 -  Nhẫn tàng hình"
  },
  {
    "title": "Ý nghĩa Nhẫn xoay bánh răng",
    "script": "G028 - Ý nghĩa Nhẫn xoay bánh răng ( các SP đều được)"
  },
  {
    "title": "Một tên gọi khác của Nhẫn xoay bánh răng",
    "script": "G029 - Một tên gọi khác Nhẫn xoay bánh răng"
  },
  {
    "title": "Nhẫn or vòng mắt mèo",
    "script": "G030 -  Nhẫn or vòng mắt mèo"
  },
  {
    "title": "ASMR",
    "script": null
  },
  {
    "title": "Truyền thuyết mắt thần Horus",
    "script": "Điều tôi thích nhất ở biểu tượng Mắt Thần Horus...\nLà nó không đại diện cho sự hoàn hảo.\nMà đại diện cho khả năng đứng dậy sau những tổn thương.\nTheo truyền thuyết Ai Cập cổ đại, Horus đã mất đi một bên mắt trong trận chiến lớn nhất cuộc đời mình.\nNhưng rồi con mắt ấy được hồi sinh.\nVà trở thành biểu tượng của sự bảo vệ, sức mạnh và sự hồi sinh.\nKhi thiết kế chiếc nhẫn này, điều tôi chú ý nhất chính là thần thái của đôi mắt Horus.\nBởi chỉ cần khác đi một chút, biểu tượng ấy sẽ mất đi ý nghĩa vốn có.\nCó lẽ chiếc nhẫn này sẽ phù hợp với những người đã từng trải qua khó khăn trong cuộc sống.\nNhững người từng tổn thương.\nNhưng vẫn lựa chọn bước tiếp.\nVì đôi khi, điều đáng quý nhất không phải là chưa từng gục ngã.\nMà là sau tất cả, chúng ta vẫn có thể đứng dậy mạnh mẽ hơn.\nNếu phải chọn một biểu tượng đại diện cho chính mình, bạn sẽ chọn gì?"
  },
  {
    "title": "Món quà tặng bản thân",
    "script": "1. [HOOK] Một chị khách tìm đến tôi kể rằng sau nhiều năm lo cho gia đình, chị chợt nhận ra mình chưa từng mua món gì thực sự thích. Không phải thiếu tiền, mà vì cái gì cũng ưu tiên cho chồng con trước.\n2. [USE CASE] Hôm nay chị muốn tự thưởng cho mình một thứ, không cần dịp gì, chỉ để thấy mình xứng đáng được quan tâm. Chồng chị không lãng mạn, nhưng hễ chị thích gì là anh vẫn âm thầm cố gắng theo cách của anh.\n3. [NEO EFFORT] Tôi gợi ý chị làm chiếc nhẫn tối giản nhưng sang trọng. HuyK đã dành 3 ngày, thử nghiệm qua 4 dáng form khác nhau để tìm ra độ bo góc hoàn hảo, sao cho chị đeo làm việc nhà hay đi tiệc đều êm ái, nhẹ nhàng.\n4. [GIÁ TRỊ] & [CẢM XÚC] Món đồ này đắt giá ở sự tinh tế ẩn giấu, bóng mịn thủ công và tỏa sáng điềm dạm như chính khí chất của chị. Làm nghề này mới thấy, hạnh phúc chỉ đơn giản là giữa bao lo toan gánh vác, mình vẫn biết cách yêu thương chính mình và có người để ý đến điều nhỏ nhặt mình thích.\n5. [CTA] Lần cuối cùng bạn tự thưởng cho bản thân là khi nào? Bình luận cho HuyK biết nhé!"
  },
  {
    "title": "Ý nghĩa biểu tượng XO",
    "script": "Bạn có biết biểu tượng XO là biểu tượng cho những cái ôm và nụ hôn không?\nMột chữ X tượng trưng cho một nụ hôn.\nMột chữ O tượng trưng cho một cái ôm.\nNhưng đôi khi, chỉ hai điều đó thôi cũng đủ khiến một người cảm thấy được yêu thương.\nĐó cũng là nguồn cảm hứng để tạo nên chiếc nhẫn này.\nĐiều tôi thích nhất không nằm ở thiết kế.\nMà nằm ở ý nghĩa phía sau nó.\nBởi có những lúc chúng ta không giỏi nói ra cảm xúc của mình.\nNhưng một cái ôm đúng lúc.\nHay một nụ hôn thật nhẹ.\nLại nói được nhiều hơn cả ngàn lời.\nCó lẽ chiếc nhẫn này sẽ phù hợp với những người luôn trân trọng những điều giản dị trong tình yêu.\nVì cuối cùng, hạnh phúc đôi khi chỉ đơn giản là biết rằng luôn có một người ở bên cạnh mình.\nHãy tag người thương để họ biết bạn cũng yêu họ rất nhiều"
  },
  {
    "title": "Lựa Chọn Thông Minh Trong Trang Sức",
    "script": "Không phải ai yêu vẻ đẹp của kim cương cũng muốn chi một khoản tiền quá lớn cho nó.\nVà tôi nghĩ điều đó hoàn toàn bình thường.\nBởi ngày nay, nhiều người không còn tìm kiếm lựa chọn đắt nhất.\nHọ tìm kiếm lựa chọn phù hợp nhất.\nSau nhiều lần thử nghiệm giữa các loại đá khác nhau, tôi quyết định lựa chọn Moissanite. Một loại đá nổi tiếng với độ sáng và khả năng phản chiếu ánh sáng cầu vồng.\n\nCó lẽ chiếc nhẫn \"tàng hình\" này sẽ phù hợp với những người yêu cái đẹp nhưng vẫn luôn trân trọng những lựa chọn thông minh.\nBởi đôi khi, giá trị không nằm ở việc bạn chi bao nhiêu tiền.\nMà nằm ở việc bạn chọn điều gì thực sự phù hợp với mình. \nBạn nghĩ sao về Moissanite?"
  },
  {
    "title": "Chiếc Nhẫn Xoay Cầu Vồng",
    "script": "Mới hôm qua thôi, có một vị khách hỏi tôi: \"Anh có mẫu nhẫn nào nhiều màu một chút không?\" Và đó là lúc tôi nghĩ đến chiếc nhẫn xoay cầu vồng này. Điều đặc biệt của nó không chỉ nằm ở những viên đá moissanite nhiều màu sắc. Mà còn ở cơ chế xoay bên trong. Khi chạm nhẹ, chiếc nhẫn có thể chuyển động mượt mà theo từng vòng xoay. Nhưng để làm được điều đó, từng viên đá đều phải được đặt đúng vị trí. Chỉ cần lệch một chút thôi, cảm giác chuyển động sẽ không còn hoàn hảo nữa. Có những lần tôi phải tháo ra làm lại chỉ vì một viên đá chưa thật sự cân đối. Nhưng khi nhìn những sắc màu ấy chuyển động cùng nhau, tôi lại thấy mọi công sức đều xứng đáng. Có lẽ cũng giống như mỗi người chúng ta. Không ai giống ai. Nhưng chính những khác biệt ấy lại tạo nên vẻ đẹp rất riêng. Bạn thích những thiết kế tối giản hay những thiết kế nhiều màu sắc như thế này?"
  },
  {
    "title": "từ chối vì thiết kế bị cũ",
    "script": "Hôm nọ, tôi nhận được một đơn đặt hàng rất đặc biệt.\nMột người ông muốn làm một chiếc nhẫn thủ công để tặng cô cháu gái vừa tròn 18 tuổi.\nÔng kể rằng đó không chỉ là một món quà.\nMà còn là lời chúc và sự yêu thương mà ông muốn gửi gắm cho cháu mình.\nTôi đã dành rất nhiều thời gian để hoàn thiện chiếc nhẫn ấy.\nNhưng đến khi hoàn thành, đơn hàng lại bị hủy.\nLý do rất đơn giản.\nCô cháu gái cảm thấy thiết kế này hơi cổ điển và không phù hợp với phong cách của mình.\nThú thật, tôi đã hơi tiếc.\nKhông phải vì đơn hàng bị hủy.\nMà vì tôi nhìn thấy rất nhiều tình cảm được gửi gắm trong món quà ấy.\nNhưng rồi tôi nghĩ...\nCó lẽ mỗi thế hệ đều có cách cảm nhận cái đẹp khác nhau.\nVà điều đó hoàn toàn bình thường.\nDù vậy, tôi vẫn rất trân trọng cơ hội được tạo ra chiếc nhẫn này.\nBởi đằng sau mỗi món trang sức, đôi khi điều quý giá nhất không nằm ở thiết kế.\nMà là câu chuyện và tình yêu thương được gửi gắm bên trong nó. \nBạn còn nhớ món quà năm 18 tuổi của mình không?"
  },
  {
    "title": "Ý nghĩa hoa linh lan",
    "script": "Người ta nói hoa linh lan là biểu tượng của hạnh phúc quay trở lại.\nVà sau khi nghe câu chuyện của một vị khách, tôi bắt đầu hiểu vì sao. Chị khách kể rằng \nMẹ chị đã trải qua một ca phẫu thuật lớn.\nCó những lúc cả nhà chỉ mong mọi chuyện được bình an.\nMay mắn là sau tất cả, sức khỏe của bà đã dần ổn định trở lại.\nVà chị muốn tìm một món quà như một lời chúc cho những ngày tháng tốt đẹp phía trước.\nSau khi nghe câu chuyện ấy, tôi đã giới thiệu chiếc vòng tay hoa linh lan này.\nBởi hoa linh lan từ lâu được xem là biểu tượng của sự trở lại của hạnh phúc và những điều tốt đẹp sau khó khăn.\nMột loài hoa nhỏ bé, giản dị nhưng lại mang theo rất nhiều hy vọng.\nChính vì vậy, khi chế tác chiếc vòng này, tôi đã dành rất nhiều thời gian cho từng chi tiết nhỏ của những bông hoa.\nBởi tôi tin rằng một món quà đẹp không chỉ nằm ở vẻ ngoài.\nMà còn nằm ở câu chuyện và lời chúc được gửi gắm bên trong nó.\nCó lẽ bởi đôi khi, điều quý giá nhất của một món quà không phải là giá trị của nó.\nMà là cảm giác được yêu thương và trân trọng khi nhận được nó."
  },
  {
    "title": "Ý nghĩa lắc tay áo giáp",
    "script": "Nhìn chiếc lắc này, nhiều người nói nó giống một bộ áo giáp thu nhỏ.\nVà có lẽ họ không sai.\nĐể hoàn thiện nó, từng mắt xích đều phải được làm và liên kết thật chính xác.\nChỉ cần sai lệch một chút thôi, toàn bộ cấu trúc sẽ không còn hoàn hảo như mong muốn.\nĐó cũng là điều khiến tôi thích những thiết kế như thế này.\nBởi chúng nhắc tôi nhớ rằng những thứ bền vững thường không được tạo nên từ một điều lớn lao.\nMà từ rất nhiều chi tiết nhỏ được hoàn thiện mỗi ngày.\nTrong cuộc sống cũng vậy.\nSự tin tưởng, tình yêu hay thành công đều được xây dựng từ những điều rất nhỏ.\nVà có lẽ điều đáng quý nhất không phải là đi thật nhanh.\nMà là đủ kiên nhẫn để làm mọi thứ thật tốt."
  },
  {
    "title": "cấu tạo của nhẫn tàng hình",
    "script": "Nhiều người hỏi tôi vì sao chiếc nhẫn này lại có cảm giác như đang phát sáng.\nThật ra điều đặc biệt nhất của nó lại nằm ở phần gần như không nhìn thấy.\nĐó là phần khung \"tàng hình\".\nKhi thiết kế chiếc nhẫn này, tôi muốn mọi ánh nhìn đều tập trung vào dải đá moissanite xung quanh.\nNghe thì đơn giản.\nNhưng để tạo được hiệu ứng đó, phần bạc phải được mài cực kỳ mỏng và đều.\nCác viên đá cũng phải được sắp xếp sát nhau đến mức gần như không có khoảng trống.\nChỉ cần lệch một chút thôi, dải ánh sáng sẽ bị đứt ngay.\nCó những lúc tôi phải chỉnh đi chỉnh lại từng viên đá chỉ vì một góc nhìn chưa thật sự hoàn hảo.\nNhưng khi hoàn thành, mọi công sức đều xứng đáng.\nBởi ở một vài góc nhìn, gần như không còn thấy khung nhẫn nữa.\nChỉ còn lại một vòng sáng lơ lửng trên tay.\nVà đó cũng chính là điều tôi thích nhất ở thiết kế này."
  },
  {
    "title": "Đôi cánh thiên thần",
    "script": "HOOK\nCó một truyền thuyết nói rằng, mỗi người khi sinh ra đều có một thiên thần lặng lẽ đi bên cạnh.\nKhông tạo ra phép màu.\nChỉ để lại một tia sáng nhỏ mỗi khi ta cần thêm một chút hy vọng.\nVà tôi đã tự hỏi...\nNếu đôi cánh ấy có thể được giữ lại bằng bạc thì sẽ trông như thế nào?\nNEO EFFORT\nMất gần 16 giờ để hoàn thiện chiếc nhẫn này.\nCó những đường cong tôi phải chỉnh đi chỉnh lại nhiều lần, vì chỉ cần lệch rất nhỏ, cảm giác đôi cánh đang ôm lấy viên đá sẽ biến mất.\nUSE CASE\nCó lẽ nó dành cho những ai muốn mang theo bên mình một lời chúc bình an, hoặc muốn gửi điều đó đến một người rất quan trọng.\nGIÁ TRỊ\nĐôi cánh nâng viên Moissanite ở trung tâm để khi gặp ánh sáng, viên đá giống như một ngôi sao nhỏ luôn đồng hành cùng người đeo.\nVới nhiều người đây chỉ là một chiếc nhẫn bạc.\nNhưng với tôi, nó là lời nhắc rằng ai cũng xứng đáng được yêu thương và luôn có một ánh sáng dẫn đường.\nCẢM XÚC\nĐiều làm tôi vui nhất không phải số chiếc nhẫn đã hoàn thành.\nMà là khoảnh khắc một người đeo nó lên tay rồi kể cho tôi nghe ý nghĩa mà họ nhìn thấy trong đôi cánh ấy.\nCTA\nNếu chiếc nhẫn này mang đến cho bạn một cảm giác bình yên, hãy để lại một ❤️ và chia sẻ:\n\"Nếu có một thiên thần bảo hộ, bạn muốn gửi lời cảm ơn họ vì điều gì?\""
  },
  {
    "title": "chiếc vương miện của mỗi cô gái",
    "script": "[HOOK]\nNgười ta vẫn kể với nhau một câu chuyện rất đẹp.\nRằng mỗi cô gái khi sinh ra đều mang trên mình một chiếc vương miện vô hình.\nKhông được làm từ vàng hay đá quý.\nMà được tạo nên từ sự dịu dàng, lòng dũng cảm và ánh sáng rất riêng chỉ thuộc về cô ấy.\n[NEO EFFORT]\nThế nhưng khi lớn lên, giữa những bộn bề của cuộc sống, nhiều người dần quên mất mình từng rực rỡ như thế.\nTôi đã mang theo ý tưởng ấy rất lâu.\nVà quyết định biến nó thành một chiếc nhẫn.\nĐể hoàn thiện thiết kế này, tôi phải chỉnh sửa từng đường cong và từng vị trí của viên đá nhiều lần.\nChỉ cần lệch đi một chút, cảm giác thanh thoát như một chiếc vương miện sẽ biến mất.\n[USE CASE]\nNếu bạn đang tìm một món trang sức không chỉ đẹp mà còn mang theo một lời nhắc dành cho chính mình...\nCó lẽ chiếc nhẫn này sẽ khiến bạn mỉm cười.\n[GIÁ TRỊ]\nPhần thân được tạo hình như một chiếc vương miện nhỏ đang nâng niu viên Moissanite ở trung tâm.\nMỗi khi ánh sáng chạm vào, viên đá lấp lánh như một ngôi sao nhỏ luôn đồng hành cùng người đeo.\nVới tôi, đây không chỉ là một chiếc nhẫn.\nMà là lời nhắc rằng mỗi người phụ nữ đều xứng đáng được yêu thương, được trân trọng và được tỏa sáng theo cách của riêng mình.\n[CẢM XÚC]\nĐiều khiến tôi hạnh phúc nhất không phải là hoàn thành thêm một tác phẩm.\nMà là khi có ai đó đeo nó lên tay và nói:\n\"Cảm giác như chiếc nhẫn này được làm ra dành riêng cho mình.\"\nKhoảnh khắc ấy khiến mọi giờ làm việc miệt mài đều trở nên xứng đáng.\n[CTA]\nNếu bạn cũng tin rằng ai cũng có một chiếc vương miện của riêng mình, hãy để lại một ❤️.\nVà chia sẻ một điều khiến bạn tự hào nhất về bản thân.\nBiết đâu câu chuyện của bạn sẽ trở thành ánh sáng nhỏ giúp một người khác nhớ rằng họ cũng luôn xứng đáng được tỏa sáng."
  },
  {
    "title": "Lời chúc được gửi gắm trong trang sức",
    "script": "Đây là lần hiếm hoi tôi quyết định tặng một món trang sức cho một vị khách. \nVài hôm trước, một người mẹ bước vào cửa hàng để tìm quà cho cậu con trai 3 tuổi.\nChỉ vài ngày nữa thôi, bé sẽ bước vào một ca phẫu thuật quan trọng sau thời gian dài điều trị căn bệnh ung thư.\nNhìn ánh mắt của chị, tôi hiểu rằng điều chị cần lúc đó không chỉ là một món quà.\nMà là một điều gì đó để tiếp thêm hy vọng cho con.\nSau một hồi trò chuyện, tôi nghĩ đến hoa linh lan.\nMột loài hoa nhỏ bé, tượng trưng cho sức sống, hy vọng và những điều tốt đẹp sẽ quay trở lại.\nVì thế, tôi đã quyết định tặng chiếc vòng này cho bé.\nKhông phải vì nó quá giá trị.\nMà vì tôi biết hành trình phía trước của gia đình sẽ còn rất nhiều khó khăn.\nTôi không thể giúp được nhiều.\nChỉ mong món quà nhỏ này sẽ thay tôi gửi đến bé một lời chúc:\nMong con luôn mạnh mẽ.\nVà mong những điều tốt đẹp nhất sẽ sớm quay trở lại với gia đình mình.\nCùng gửi một lời chúc đến cậu bé nhỏ này nhé. ❤️"
  },
  {
    "title": "Người giàu đeo gì",
    "script": null
  },
  {
    "title": "điều khó nhất khi làm nhẫn mắt thần",
    "script": null
  },
  {
    "title": "Một Thiết Kế Xứng Đáng Với Viên Ruby",
    "script": null
  },
  {
    "title": "lắc tay tượng trưng hành trình đã đi qua",
    "script": null
  },
  {
    "title": "câu chuyện lắc tennis",
    "script": null
  },
  {
    "title": "nhẫn này chỉ dành cho nam?",
    "script": null
  },
  {
    "title": "mua nhẫn cầu hôn bạn trai",
    "script": null
  },
  {
    "title": "nhẫn cho khách bigsize",
    "script": null
  },
  {
    "title": "Câu chuyện sản phẩm dây chuyền mặt trăng",
    "script": "Tôi đã vẽ lại chiếc mặt dây chuyền này hơn 10 lần chỉ vì một chi tiết nhỏ. Tôi đã lấy cảm hứng từ hình ảnh mặt trăng đang ôm lấy một hành tinh. Nhìn từ xa, nó giống như hai thiên thể đang chuyển động giữa bầu trời đêm. Khi lên ý tưởng cho thiết kế này, tôi đã vẽ lại rất nhiều lần. Có bản thì mặt trăng quá lớn. Có bản thì hành tinh lại quá nhỏ. Tôi cứ nghĩ mình đang đi tìm một tỷ lệ đẹp. Nhưng càng chỉnh sửa, tôi càng nhận ra điều mình đang tìm kiếm không chỉ là một thiết kế đẹp. Mà là một cảm giác. Cuối cùng, tôi vẫn chọn cách để mặt trăng bao quanh hành tinh. Bởi mỗi lần nhìn vào, tôi lại nghĩ đến những người luôn âm thầm bảo vệ chúng ta trong cuộc sống. Đó có thể là cha mẹ. Là người bạn đời. Là những người luôn xuất hiện mỗi khi chúng ta cần giúp đỡ. Điều đặc biệt là phần lớn thời gian, chúng ta lại ít khi nhận ra điều đó. Bởi sự quan tâm chân thành thường không quá ồn ào. Nó giống như mặt trăng vậy. Luôn ở đó. Âm thầm. Lặng lẽ. Nhưng chưa bao giờ biến mất. Và rồi tôi nhận ra rằng... Đến một lúc nào đó, chúng ta cũng sẽ trở thành người che chở cho người khác. Cho con cái. Cho gia đình. Cho những người mà mình yêu thương. Giống như mặt trăng đang ôm lấy hành tinh trong thiết kế này. Không cần quá nổi bật. Chỉ cần luôn hiện diện khi người kia cần. Nếu được tặng thiết kế này cho một người, bạn sẽ nghĩ đến ai đầu tiên?"
  },
  {
    "title": "Giữ Lấy Một Nghề",
    "script": "[HOOK]\nĐôi khi tôi tự hỏi...\nSau này sẽ còn bao nhiêu người sẵn sàng ngồi hàng giờ chỉ để làm nên một chiếc nhẫn hoàn toàn bằng tay?\n[NEO EFFORT]\nNgay ở phần viền mà bạn đang nhìn thấy trong video này, tôi đã đánh bóng đi đánh bóng lại nhiều lần, cho đến khi ánh sáng phản chiếu thật đều trên bề mặt.\nCó những ngày tôi dành gần hai giờ chỉ cho một chi tiết nhỏ.\nCó lúc phải làm lại ba lần chỉ vì khi cầm trên tay, cảm giác vẫn chưa thật sự đúng.\nMáy có thể làm nhanh hơn.\nNhưng có những cảm nhận chỉ đôi tay của người thợ mới biết được.\n[USE CASE]\nCó lẽ khi cầm một chiếc nhẫn trên tay, nhiều người chỉ nhìn thấy vẻ đẹp của nó.\nNhưng với người thợ, mỗi đường giũa, mỗi lần đánh bóng đều là kết quả của nhiều năm kiên nhẫn và luyện tập.\n[GIÁ TRỊ]\nCông nghệ ngày càng phát triển.\nMáy móc có thể tạo ra những món trang sức rất đẹp.\nNhưng điều khiến tôi suy nghĩ nhiều hơn lại là một chuyện khác.\nSẽ có ngày không còn nhiều người muốn học những kỹ năng phải mất rất nhiều năm mới thành thạo.\nCó những kỹ năng không thể học chỉ bằng vài đoạn video.\nCũng không thể tải về từ một chiếc máy tính.\nChúng chỉ được truyền từ đôi tay của người thợ này sang đôi tay của người thợ khác.\nVà nếu một ngày không còn ai tiếp tục, những kỹ năng ấy cũng sẽ lặng lẽ biến mất.\n[CẢM XÚC]\nCó lẽ tôi nghĩ nhiều quá.\nNhưng cũng chính vì thế mà mỗi ngày tôi vẫn ngồi trước bàn chế tác.\nVẫn cầm chiếc giũa quen thuộc.\nVẫn kiên nhẫn đánh bóng từng chiếc nhẫn như cách những người thợ đi trước đã từng làm.\nBởi tôi không chỉ muốn tạo ra một món trang sức.\nTôi còn muốn gìn giữ một nghề đã được truyền lại qua rất nhiều thế hệ.\n[CTA]\nBạn đã từng sở hữu một món đồ thủ công khiến mình trân trọng mãi chưa?\nTôi rất muốn nghe câu chuyện của bạn.\n[SIGNATURE]\nCó những kỹ năng không nằm trong sách vở.\nChúng nằm trong đôi tay của người thợ.\nVà tôi hy vọng đôi tay mình sẽ còn tiếp tục kể câu chuyện ấy thật lâu nữa."
  },
  {
    "title": "anh khách phá sản",
    "script": "Tuần trước, có một anh khách tìm đến cửa hàng và nói với tôi: \"Anh làm giúp em một chiếc nhẫn... để mỗi lần nhìn vào, em có thêm động lực bắt đầu lại.\" Tò mò nên tôi hỏi chuyện. Anh kể trước đây từng có một công ty của riêng mình. Chỉ vì một quyết định sai... mọi thứ dần sụp đổ. Cuối cùng, anh phải gác lại giấc mơ, đi làm công nhân để kiếm thu nhập và chuẩn bị cho một lần bắt đầu mới. Anh chỉ cười rồi nói: \"Em không cần một món đồ đắt tiền. Em chỉ cần một thứ nhắc mình rằng... đừng bỏ cuộc.\" Nghe đến đó, tôi nghĩ ngay đến chiếc nhẫn xoay cầu vồng. Mỗi lần vòng nhẫn xoay đi một vòng, tôi lại thấy nó giống cuộc sống. Không có ngày nào đứng yên. Không có khó khăn nào kéo dài mãi mãi. Tôi không biết chiếc nhẫn này có mang lại may mắn hay không. Nhưng tôi hy vọng... mỗi lần xoay nó trên tay, anh sẽ nhớ rằng: Mình vẫn còn cơ hội để bắt đầu lại. Và đôi khi... chỉ cần còn tin vào điều đó, là đã đủ để bước tiếp rồi. Nếu hôm nay được bắt đầu lại từ đầu, điều đầu tiên bạn sẽ làm là gì?"
  },
  {
    "title": "phiên bản bạc của nhẫn công chúa",
    "script": "Có lẽ đây là tin mà nhiều anh chị em đã chờ khá lâu. Trước đây, mẫu nhẫn này tôi chỉ chế tác bằng vàng. Nhưng sau mỗi video, tôi lại nhận được rất nhiều tin nhắn: \"Anh ơi, mẫu này có làm bằng bạc không?\" Thật ra tôi cũng muốn làm từ lâu. Nhưng phải mất khá nhiều thời gian để tính toán lại kết cấu, chất liệu và chi phí sao cho vẫn giữ được vẻ đẹp của thiết kế mà giá thành hợp lý hơn. Sau nhiều lần cân nhắc, cuối cùng tôi cũng hoàn thiện phiên bản bạc S925. Vẫn là kiểu dáng quen thuộc mà mọi người yêu thích. Chỉ khác ở chất liệu, để nhiều anh chị em có thể dễ dàng sở hữu hơn. Nếu trước đây bạn từng hỏi tôi về mẫu này nhưng chưa có cơ hội đặt làm, thì bây giờ đã có rồi nhé. Hy vọng phiên bản bạc S925 này sẽ là lựa chọn phù hợp dành cho nhiều người hơn."
  },
  {
    "title": "Nhẫn Kim Vũ",
    "script": null
  },
  {
    "title": "Nhẫn Moissanite 12mm",
    "script": null
  },
  {
    "title": "Nếu chỉ được giữ lại 1 món trang sức",
    "script": "[HOOK]\nNếu cả đời chỉ được giữ lại một món trang sức, bạn sẽ chọn món nào?\nCòn với tôi, đó sẽ là một sợi dây chuyền.\nBởi nó luôn nằm gần trái tim hơn bất kỳ món trang sức nào khác.\n[NEO EFFORT]\nĐiều tôi thích nhất ở sợi dây chuyền Moissanite này là viên đá ở giữa không được cố định hoàn toàn.\nNó được thiết kế để chuyển động nhẹ theo từng nhịp thở và từng cử động của cơ thể.\nĐể tạo được hiệu ứng đó, tôi phải điều chỉnh nhiều lần độ cân bằng và độ linh hoạt của phần treo viên đá, chỉ cần quá chặt hoặc quá lỏng, chuyển động sẽ không còn tự nhiên nữa.\n[USE CASE]\nDù đi làm, gặp bạn bè hay chỉ là một ngày bình thường.\nSợi dây chuyền này vẫn tạo nên một điểm nhấn tinh tế mà không hề phô trương.\n[GIÁ TRỊ]\nMỗi khi bạn cử động, viên đá lại chuyển động nhẹ và bắt sáng theo một cách khác nhau.\nĐối với tôi, điều đẹp nhất không nằm ở độ lấp lánh.\nMà là cảm giác nó luôn chuyển động cùng người đeo, như đang lặng lẽ đồng hành trong từng khoảnh khắc của cuộc sống.\n[CẢM XÚC]\nTôi luôn tin rằng một món trang sức đẹp không phải là món nổi bật nhất.\nMà là món khiến bạn mỉm cười mỗi lần vô tình nhìn xuống và nhận ra nó vẫn luôn ở đó.\n[SIGNATURE]\nCó những món trang sức không cần lên tiếng.\nChỉ cần lặng lẽ đồng hành cùng người đeo mỗi ngày, như thế đã đủ ý nghĩa."
  },
  {
    "title": "Phải cận thận với chiếc lắc tay này nhé!",
    "script": null
  },
  {
    "title": "Dây chuyền trái tim đính đá",
    "script": null
  },
  {
    "title": "Cẩn thận khi đeo ra ngoài",
    "script": null
  },
  {
    "title": "Nếu chỉ có một món trang sức để đeo suốt đời",
    "script": null
  },
  {
    "title": "Thẩm mỹ của người già",
    "script": "Ai nói gu thẩm mỹ của người lớn tuổi là lỗi thời? Tuần trước, có một cô đến tôi đặt làm một chiếc vòng bạc rất đặc biệt. Không hoa văn, không chạm khắc, chỉ là một chiếc vòng bạc trơn đơn giản. Dù tôi đã giới thiệu nhiều mẫu đẹp hơn, cô vẫn nhất quyết chọn thiết kế này. Lý do khiến tôi rất xúc động. Cô nói sau này chiếc vòng sẽ được truyền lại cho con gái, rồi tiếp tục cho cháu gái. Ban đầu cô cũng định khắc thêm họa tiết yêu thích, nhưng rồi đổi ý. Cô muốn chiếc vòng đủ tinh tế để tồn tại cùng thời gian, nhưng cũng đủ giản dị để không bao giờ lỗi mốt. Lúc đó tôi mới hiểu, đây không chỉ là một món trang sức. Mà là tình yêu và lời nhắn gửi của một người mẹ, được trao từ thế hệ này sang thế hệ khác qua một chiếc vòng bạc giản đơn."
  },
  {
    "title": "Tại sao giới Mafia lại đeo nhẫn Signet",
    "script": null
  }
];

async function main() {
  console.log(`🌱 Seed ${DATA.length} team_contents cho team "${TEAM_NAME}"\n`);

  const team = await prisma.team.findFirst({ where: { name: TEAM_NAME } });
  if (!team) throw new Error(`Không tìm thấy team "${TEAM_NAME}"`);

  const addedBy = await prisma.user.findFirst({ where: { email: ADDED_BY_EMAIL } });
  if (!addedBy) throw new Error(`Không tìm thấy user email "${ADDED_BY_EMAIL}"`);

  const existing = await prisma.teamContent.findMany({
    where: { team_id: team.id },
    select: { title: true },
  });
  const existingTitles = new Set(existing.map((c) => c.title));

  const toInsert = DATA.filter((r) => !existingTitles.has(r.title));
  const skipped = DATA.length - toInsert.length;

  if (toInsert.length === 0) {
    console.log(`Không có gì để insert (${skipped} title đã tồn tại sẵn).`);
    return;
  }

  const result = await prisma.teamContent.createMany({
    data: toInsert.map((r) => ({
      team_id: team.id,
      brand_type: 'TRANG_SUC' as const,
      market: 'INDONESIA',
      title: r.title,
      script: r.script,
      added_by_id: addedBy.id,
    })),
  });

  console.log(`Inserted: ${result.count} | Skipped (đã tồn tại): ${skipped}`);
}

main()
  .catch((e) => {
    console.error('[seed_team_contents_global_indo] failed:', e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
