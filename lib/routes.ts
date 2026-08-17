/**
 * Các đường dẫn được nhắc tới ở nhiều nơi.
 *
 * Trang chủ "/" là trang giới thiệu công khai; bàn làm việc của khách nằm ở
 * `/studio`. Hai thứ này từng là một, và khi tách ra thì có tới tám chỗ trong
 * mã nguồn đang trỏ "/" với nghĩa "vào tạo ảnh" — sót một chỗ là khách bấm nút
 * xong quay về đúng trang bán hàng vừa đứng. Khai báo ở đây để lần sau đổi
 * đường dẫn chỉ phải sửa một dòng.
 *
 * Đường dẫn phía khách viết bằng tiếng Anh vì chúng nằm trên thanh địa chỉ —
 * khách quốc tế đọc và chia sẻ chúng. Riêng trang quản trị giữ `/quan-tri`:
 * đó là khu vực nội bộ, toàn bộ giao diện vẫn là tiếng Việt.
 */

/** Trang giới thiệu, cũng là trang chủ. */
export const LANDING = '/';

/** Bàn làm việc: nơi khách đăng nhập xong được đưa tới. */
export const APP_HOME = '/studio';

export const LOGIN = '/login';
export const SIGNUP = '/signup';
export const FORGOT_PASSWORD = '/forgot-password';
export const RESET_PASSWORD = '/reset-password';
export const POLICY = '/policies';
export const HISTORY = '/history';
export const WALLET = '/wallet';
export const CREDITS = '/credits';
export const ACCOUNT = '/account';
export const AFFILIATE = '/affiliate';
export const ADMIN = '/quan-tri';

/**
 * Đường dẫn tiếng Việt của bản trước, chuyển hướng sang địa chỉ mới.
 *
 * Giữ lại vì link cũ đã nằm trong bookmark, lịch sử trình duyệt và trong các
 * link giới thiệu affiliate đã phát ra ngoài — bỏ đi là chúng rơi thẳng vào
 * trang chủ mà khách không hiểu vì sao.
 */
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/gioi-thieu': LANDING,
  '/dang-nhap': LOGIN,
  '/dang-ky': SIGNUP,
  '/quen-mat-khau': FORGOT_PASSWORD,
  '/dat-lai-mat-khau': RESET_PASSWORD,
  '/chinh-sach': POLICY,
  '/tao-anh': APP_HOME,
  '/lich-su': HISTORY,
  '/vi-diem': WALLET,
  '/nap-tien': CREDITS,
  '/tai-khoan': ACCOUNT,
};
