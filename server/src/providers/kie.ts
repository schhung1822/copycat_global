import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import type { GenerateRequest, GenerateResult, ImageProvider, ValidateInput } from './types.js';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 6 * 60 * 1_000; // bỏ cuộc sau 6 phút
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Đặc tả tham số của từng model trên Kie.ai.
 *
 * Mỗi model nhận ảnh đầu vào bằng MỘT TÊN THAM SỐ KHÁC NHAU và không phải model
 * nào cũng có `resolution` hay `output_format`. Gửi sai tên là bị từ chối ngay.
 * Nguồn: https://docs.kie.ai/llms.txt → các trang /market/...
 *
 * Thêm model mới của Kie.ai: thêm một dòng ở đây theo đúng trang tài liệu của nó,
 * rồi thêm dòng tương ứng trong bảng giá ở trang Quản trị.
 */
interface KieModelSpec {
  /** Tên trường chứa danh sách URL ảnh đầu vào */
  imageParam: 'image_input' | 'image_urls' | 'input_urls';
  maxImages: number;
  /** Model bắt buộc phải có ảnh đầu vào (không dùng để sinh ảnh từ chữ) */
  imagesRequired: boolean;
  aspectRatios: string[];
  /** null = model không có tham số resolution, không được gửi lên */
  resolutions: string[] | null;
  /** null = model không có tham số output_format */
  outputFormat: string | null;
  /** Ràng buộc riêng giữa các tham số. Trả về thông báo lỗi, hoặc null nếu hợp lệ. */
  restrict?: (resolution: string, aspectRatio: string) => string | null;
}

const GOOGLE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'];
const NANO_BANANA_2_RATIOS = [...GOOGLE_RATIOS, '1:4', '4:1', '1:8', '8:1'];
const GPT_IMAGE_2_RATIOS = [
  'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
];

const MODEL_SPECS: Record<string, KieModelSpec> = {
  // https://docs.kie.ai/market/google/pro-image-to-image
  'nano-banana-pro': {
    imageParam: 'image_input',
    maxImages: 8,
    imagesRequired: false,
    aspectRatios: GOOGLE_RATIOS,
    resolutions: ['1K', '2K', '4K'],
    outputFormat: 'png',
  },
  // https://docs.kie.ai/market/google/nanobanana2
  'nano-banana-2': {
    imageParam: 'image_input',
    maxImages: 14,
    imagesRequired: false,
    aspectRatios: NANO_BANANA_2_RATIOS,
    resolutions: ['1K', '2K', '4K'],
    outputFormat: 'png',
  },
  // https://docs.kie.ai/market/google/nano-banana-2-lite — không có resolution / output_format
  'nano-banana-2-lite': {
    imageParam: 'image_urls',
    maxImages: 10,
    imagesRequired: false,
    aspectRatios: NANO_BANANA_2_RATIOS,
    resolutions: null,
    outputFormat: null,
  },
  // https://docs.kie.ai/market/google/nano-banana-edit — bản Nano Banana đời đầu
  'google/nano-banana-edit': {
    imageParam: 'image_urls',
    maxImages: 10,
    imagesRequired: true,
    aspectRatios: GOOGLE_RATIOS,
    resolutions: null,
    outputFormat: 'png',
  },
  // https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image
  'gpt-image-2-image-to-image': {
    imageParam: 'input_urls',
    maxImages: 16,
    imagesRequired: true,
    aspectRatios: GPT_IMAGE_2_RATIOS,
    resolutions: ['1K', '2K', '4K'],
    outputFormat: null,
    restrict: (resolution, aspectRatio) => {
      if (resolution !== '1K' && (aspectRatio === '5:4' || aspectRatio === '4:5')) {
        return 'GPT Image 2 only supports the 5:4 and 4:5 ratios at 1K. Pick 1K, or choose another ratio.';
      }
      if (resolution === '4K' && aspectRatio === '1:1') {
        return 'GPT Image 2 cannot output 4K at a 1:1 ratio. Pick 2K, or choose another ratio.';
      }
      return null;
    },
  },
};

/** Dùng cho model admin tự thêm mà chưa khai báo ở trên — theo dạng phổ biến nhất của Kie.ai. */
const DEFAULT_SPEC: KieModelSpec = {
  imageParam: 'image_input',
  maxImages: 8,
  imagesRequired: false,
  aspectRatios: GOOGLE_RATIOS,
  resolutions: ['1K', '2K', '4K'],
  outputFormat: 'png',
};

const specFor = (providerModel: string): KieModelSpec => MODEL_SPECS[providerModel] ?? DEFAULT_SPEC;

export const KNOWN_KIE_MODELS = Object.keys(MODEL_SPECS);

/**
 * Tỉ lệ dùng khi khách chọn "Tự động".
 *
 * "auto" là một lựa chọn của GIAO DIỆN chứ không phải giá trị gửi lên Kie.ai:
 * gửi thẳng "auto" thì model tự đoán khung hình và hay cho ra ảnh vuông hoặc
 * ngang, trong khi ảnh quảng cáo gần như luôn là ảnh dọc. Quy về 3:4 — đúng như
 * bản chạy ổn định trong copycat_goc — cho ra khung hình đoán trước được.
 */
const DEFAULT_RATIO = '3:4';

/** Tỉ lệ thật sự đặt vào payload: bỏ "auto", và lùi về 3:4 nếu model không nhận. */
function resolveAspectRatio(spec: KieModelSpec, requested: string): string {
  const concrete = spec.aspectRatios.filter((ratio) => ratio !== 'auto');
  if (requested !== 'auto' && concrete.includes(requested)) return requested;
  return concrete.includes(DEFAULT_RATIO) ? DEFAULT_RATIO : concrete[0] ?? DEFAULT_RATIO;
}

// ---------------------------------------------------------------------------

const authHeaders = () => ({
  Authorization: `Bearer ${env.kie.apiKey.trim()}`,
  'Content-Type': 'application/json',
});

/*
 * Thông báo cho KHÁCH cố ý không nhắc tên nhà cung cấp và không lộ chi tiết kỹ
 * thuật: khách mua dịch vụ của bạn, việc bạn gọi API của ai là chuyện nội bộ.
 * Toàn bộ chi tiết để gỡ lỗi được in ra log của server cho quản trị viên.
 */
const USER_MESSAGE = {
  system: 'We could not generate that image right now. Please try again in a few minutes.',
  config: 'Image generation is not available yet. Please contact support.',
  timeout: 'This image took too long and was stopped. Please try again.',
} as const;

/** Ghi chi tiết kỹ thuật ra log rồi ném lỗi với câu ngắn gọn cho khách. */
function providerFailure(logDetail: string, userMessage: string = USER_MESSAGE.system, code = 'provider_error'): never {
  console.error(`[kie] ${logDetail}`);
  throw new AppError(502, userMessage, code);
}

function throwAuthFailed(url: string, detail: string): never {
  console.error(
    `\n[kie] API KEY BỊ TỪ CHỐI khi gọi ${url}\n` +
      `  Phản hồi: ${detail}\n` +
      '  Kiểm tra KIE_API_KEY trong file .env — key sai, đã bị thu hồi, hoặc bị dán thiếu ký tự.\n' +
      '  Thử trực tiếp bằng lệnh:\n' +
      `      KEY=$(grep -E '^KIE_API_KEY=' .env | cut -d= -f2- | tr -d "\\"'\\r ")\n` +
      `      curl -s -X POST ${url} \\\n` +
      '        -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\\n' +
      `        -d '{"base64Data":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=","uploadPath":"images"}'\n`,
  );
  throw new AppError(502, USER_MESSAGE.config, 'provider_auth');
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await res.text();

  if (res.status === 401 || res.status === 403) throwAuthFailed(url, text.slice(0, 300));

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) providerFailure(`HTTP ${res.status} tại ${url}: ${text.slice(0, 300)}`);
    providerFailure(`Phản hồi không phải JSON tại ${url}: ${text.slice(0, 300)}`);
  }

  // Endpoint upload trả HTTP 200 nhưng nhét code 401 vào thân phản hồi, nên kiểm
  // tra mã HTTP thôi là lọt. Thiếu nhánh này thì lỗi sai key hiện ra dưới dạng
  // "Không upload được ảnh" chung chung, rất khó đoán nguyên nhân.
  if (data?.code === 401 || data?.code === 403) throwAuthFailed(url, String(data?.msg ?? text).slice(0, 300));

  if (!res.ok) {
    providerFailure(`HTTP ${res.status} tại ${url}: ${data?.msg ?? text.slice(0, 300)}`);
  }
  return data;
}

/** Kie.ai yêu cầu ảnh đầu vào là URL public, nên phải upload base64 lên trước. */
async function uploadImage(dataUri: string): Promise<string> {
  const data = await requestJson(env.kie.uploadUrl, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ base64Data: dataUri, uploadPath: 'images' }),
  });

  if (data.success === false && data.code !== 200) {
    providerFailure(`Upload ảnh thất bại: ${data.msg ?? 'lỗi không rõ'}`);
  }

  const fileUrl: unknown =
    data.data?.downloadUrl ?? data.data?.fileUrl ?? data.data?.url ?? data.downloadUrl ?? data.url ?? data.fileUrl;

  if (typeof fileUrl !== 'string' || !/^https?:\/\//.test(fileUrl)) {
    providerFailure(`Upload xong nhưng không có URL hợp lệ: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return fileUrl;
}

/*
 * =============================================================================
 *  PROMPT GỬI LÊN MODEL
 * =============================================================================
 *
 * Viết bằng tiếng Anh vì các model ảnh đều được huấn luyện chủ yếu trên tiếng
 * Anh và bám chỉ dẫn tiếng Anh chặt hơn hẳn. Riêng phần khách nhập được giữ
 * NGUYÊN VĂN (thường là tiếng Việt) — dịch máy dễ làm sai ý khách, và các model
 * này đều đọc được tiếng Việt khi đã có khung tiếng Anh dẫn dắt.
 *
 * Prompt này ra đời sau khi thử ba cách trên cùng một cặp ảnh thật (mẫu: đôi
 * Nike Dunk xanh chụp từ trên xuống; sản phẩm: đôi sneaker trắng xám FASHION
 * SPORT), chạy trên Nano Banana 2:
 *
 *   - Tả vai trò trừu tượng ("Image 1 là REFERENCE STYLE — composition, lighting,
 *     vibe") thì model hiểu "style" bao gồm cả ĐẶC ĐIỂM SẢN PHẨM của ảnh mẫu, và
 *     dập luôn logo Nike lên giày của khách. Bố cục đúng nhưng sản phẩm sai —
 *     kiểu hỏng tệ nhất vì nhìn thoáng qua vẫn thấy "đẹp".
 *   - Nói thêm "Image 2 là TARGET PRODUCT, đừng để sản phẩm ảnh mẫu xuất hiện"
 *     thì hết logo lạ, nhưng chữ trên sản phẩm bị vẽ sai.
 *   - Mô tả công việc như một THAO TÁC SỬA ẢNH CỤ THỂ — "chụp lại đúng tấm ảnh
 *     này, thay món đồ trong đó" — thì đúng cả bố cục lẫn sản phẩm, ba lần chạy
 *     liên tiếp đều đạt, và đúng cả trên bộ ảnh quần áo khác hẳn thể loại.
 *
 * Nên khung dưới đây cố tình KHÔNG dùng từ trừu tượng như "style", "vibe",
 * "mimic". Nó nêu đích danh từng thứ phải giữ (góc máy, số lượng món, cách xếp
 * chồng, nền, ánh sáng, khung hình) và từng thứ phải đổi. Đổi lại chữ trừu tượng
 * là mở đường cho model tự diễn giải, mà nó luôn diễn giải theo hướng bê nguyên
 * sản phẩm của ảnh mẫu sang.
 *
 * Vẫn giữ ngắn: không đánh số bước, không HARD RULES, không dặn "bản thứ mấy
 * phải khác đi". Muốn siết thêm thì viết vào ô "Mô tả thêm" ở giao diện — ở đó
 * khách sửa được cho từng bộ ảnh, còn sửa ở đây là ép cứng cho mọi khách.
 */

/** "Image 2" hoặc "Images 2–4", tuỳ số ảnh sản phẩm khách gửi. */
const productRange = (count: number, firstIndex: number): string =>
  count > 1 ? `Images ${firstIndex}–${firstIndex + count - 1}` : `Image ${firstIndex}`;

/*
 * Hướng đổi cho từng bản từ thứ hai trở đi.
 *
 * Mỗi ảnh là một lệnh gọi API riêng, model không nhìn thấy các bản còn lại. Bảo
 * chung chung "hãy làm khác đi" thì bốn bản vẫn ra na ná nhau vì cùng một prompt
 * dẫn tới cùng một vùng kết quả. Giao cho mỗi bản một hướng riêng thì chúng tách
 * ra thật sự, mà mỗi bản vẫn có mục tiêu rõ ràng thay vì tự bịa.
 *
 * TẤT CẢ đều là thay đổi VỀ CÁCH CHỤP, không phải về bối cảnh. Một bản trước đây
 * cho phép "đổi sang bối cảnh khác" và các bản 2–4 bỏ luôn ảnh mẫu: một bản ra
 * bậc thềm ngoài trời, một bản ra tường đất nung lúc hoàng hôn. Đẹp nhưng không
 * còn là thiết kế khách chọn. Khách cần bốn phương án của CÙNG một buổi chụp,
 * không phải bốn buổi chụp khác nhau.
 *
 * Xoay vòng khi khách tạo nhiều hơn số hướng có ở đây.
 */
const VARIATION_ANGLES = [
  'change how the product is posed and the angle the camera looks at it from',
  'change how the items are arranged and overlap, and change the crop and how close the camera is',
  'change the direction and mood of the light, and the small styling details around the product',
];

function buildPrompt(request: GenerateRequest): string {
  const userPrompt = request.prompt.trim();
  const productCount = Math.max(request.productImages.length, 1);
  const index = Math.max(request.variantIndex ?? 1, 1);
  const total = Math.max(request.variantTotal ?? 1, 1);
  /*
   * Bản 1 luôn là bản bám sát ảnh mẫu — khách cần một bản "chuẩn" để dùng ngay.
   * Chỉ từ bản 2 mới được nới ra thành phương án sáng tạo.
   */
  const isVariation = total > 1 && index > 1;
  const blocks: string[] = [];

  if (request.referenceImage) {
    const products = productRange(productCount, 2);

    blocks.push(
      'Take the photograph in Image 1 and swap out the product it shows.',

      /*
       * Nhắc model đọc dải nhãn dán sẵn trên đầu mỗi ảnh (xem lib/imageLabel.ts).
       * Chính dải nhãn mới là thứ chữa được lỗi đảo vai — đo được 0/15 lần đảo so
       * với 5/8 khi không dán. Câu này chỉ để model biết mà nhìn vào đó, và biết
       * rằng dải nhãn không phải một phần của tấm ảnh.
       */
      'Each input image carries a coloured label bar across its very top saying what that image is for.\n' +
        'Those bars are the authority on which image is which — trust them over anything else. They are not\n' +
        'part of the photographs: never draw a label bar, its colour or its text in your result.',

      `Image 1 = the photograph to recreate. ${products} = the replacement product` +
        (productCount > 1 ? ', shown from different angles or as its separate pieces.' : '.'),

      isVariation
        ? /*
           * Một lệnh duy nhất "chép lại ảnh mẫu, được đổi đúng những thứ này" chứ
           * KHÔNG đặt "chép cho giống" cạnh "hãy làm khác đi": hai câu ngược nhau
           * trong cùng một prompt thì model chọn bừa một bên, và đó chính là hai
           * kiểu hỏng khách gặp — một ảnh giữ góc ảnh sản phẩm, một ảnh giữ giày
           * của ảnh mẫu rồi tô lại màu.
           *
           * Danh sách được đổi là danh sách ĐÓNG. Câu chung chung kiểu "sáng tạo
           * hơn đi" là thứ khiến model bỏ luôn ảnh mẫu.
           */
          'Recreate Image 1 — the same scene, the same setting and surface, the same background, the same\n' +
            'styling — but showing the replacement product instead of the product from Image 1.\n' +
            `This is take ${index} of ${total}. Take 1 reproduces Image 1 exactly, so this one has to look\n` +
            'visibly different from it — but it is still the same photo shoot, not a new one. Keep the setting\n' +
            `and vary the shot itself: ${VARIATION_ANGLES[(index - 2) % VARIATION_ANGLES.length]}. Small\n` +
            'creative touches that suit the scene are welcome. Do not move the product somewhere else and do\n' +
            'not invent a different kind of scene.'
        : 'Recreate Image 1 as closely as you can — same camera angle, same number of items and how they are\n' +
            'placed and overlap, same background, same lighting and shadows, same crop and framing — but showing\n' +
            'the replacement product instead of the product from Image 1.',

      // Đoạn này KHÔNG đổi theo bản: sản phẩm nằm ngoài phạm vi được sáng tạo.
      // Đúng chỗ bản prompt cũ hỏng — nó cho phép bản 2 trở đi đổi cả "dáng sản
      // phẩm", và thứ model đổi đầu tiên luôn là chính món hàng.
      'The replacement product keeps its own real shape, colours, materials, prints, logos and lettering\n' +
        `exactly as in ${products}. Do not restyle it, and do not give it the colours or the logos of the\n` +
        'product from Image 1.',

      /*
       * ĐỪNG thêm câu cấm logo kiểu "never put a brand logo, swoosh, monogram on
       * the product". Đã thử: kết quả TỆ HẲN ĐI — một lần ra nửa giày mẫu nửa giày
       * khách, một lần ra nguyên đôi giày của ảnh mẫu. Gọi tên thứ cần tránh làm
       * chính nó nổi bật lên trong đầu model, đúng kiểu "đừng nghĩ đến con voi".
       * Câu khẳng định "giữ đúng như trong ảnh sản phẩm" ở trên hiệu quả hơn hẳn.
       */
      'The product from Image 1 must not appear anywhere in the result.',

      /*
       * Chặn lỗi ĐẢO VAI.
       *
       * Khi ảnh sản phẩm khách tải lên cũng là một tấm ảnh có bối cảnh — người
       * mẫu mặc đồ, quần áo treo trong shop — chứ không phải ảnh nền trắng, thì
       * hai đầu vào trông cùng một thể loại và model không còn suy ra được cái
       * nào là mẫu, cái nào là hàng. Nó đoán, và có lúc đoán ngược: lấy bối cảnh
       * của ảnh sản phẩm rồi mặc lại đồ của ảnh mẫu. Sai toàn bộ chứ không phải
       * sai một chi tiết.
       *
       * Nói thẳng rằng hai ảnh có thể giống thể loại nhau, và neo vai trò vào
       * THỨ TỰ chứ không vào nội dung.
       */
      'The two images may look like the same kind of photograph. Do not let that confuse you and do not\n' +
        'swap their roles: the scene always comes from Image 1, the product always comes from Image 2.',
    );
  } else {
    // Không có ảnh mẫu: chỉ còn nhiệm vụ dựng bối cảnh quanh sản phẩm.
    const products = productRange(productCount, 1);

    blocks.push(
      'Create one finished, professional advertising photograph of the product shown in the input image(s).',

      `${products} = the product. Keep it exactly as it is: same shape, colours, materials, prints, logos\n` +
        'and lettering. Do not restyle it.',
    );

    if (!userPrompt) blocks.push('Place it in a clean, well-lit commercial studio scene.');
  }

  /*
   * Mô tả của khách phải nói rõ nó ĐÈ ĐƯỢC lệnh bám ảnh mẫu, nhưng KHÔNG đè được
   * nhận diện sản phẩm. Thiếu vế đầu thì khách bảo "đổi nền màu be" mà model vẫn
   * giữ nguyên nền ảnh mẫu; thiếu vế sau thì khách mô tả gì hơi lạ là model coi
   * như được phép vẽ lại luôn món hàng.
   */
  if (userPrompt) {
    blocks.push(
      [
        'USER INSTRUCTIONS — written by the customer, often in Vietnamese. Follow them whatever the language.',
        request.referenceImage
          ? 'Where they ask for something different from Image 1 — scene, background, colours, mood, framing —\n' +
            'follow them instead, and keep Image 1 only for what they did not mention.'
          : 'They define the scene.',
        // Bản sáng tạo vẫn phải nằm trong khuôn khách đặt: khách bảo "nền gỗ" thì
        // cả bốn bản đều nền gỗ, chỉ khác nhau ở phần khách bỏ ngỏ.
        ...(isVariation
          ? [
              'They outrank the freedom given above too: your different concept has to stay inside what they\n' +
                'asked for, and vary only the things they left open.',
            ]
          : []),
        'The one thing they can never change is the product itself.',
        '"""',
        userPrompt,
        '"""',
      ].join('\n'),
    );
  }

  /*
   * Câu chốt, luôn nằm CUỐI prompt.
   *
   * Model bám câu cuối cùng chặt hơn các câu giữa. Thiếu nó thì khi khách không
   * nhập mô tả — lúc prompt kết thúc ngay sau phần tả nhiệm vụ — có lần model để
   * đặc điểm của sản phẩm trong ảnh mẫu lẫn sang: đã bắt gặp một chiếc giày mọc
   * ra logo và chữ của đôi giày trong ảnh mẫu. Khi có mô tả thì khối USER
   * INSTRUCTIONS vô tình đóng vai trò này, nên lỗi chỉ hiện ở đường không mô tả.
   */
  if (request.referenceImage) {
    blocks.push(
      // Soát cả HAI chiều. Câu cũ chỉ soát "sản phẩm có đúng không", nên lúc model
      // đảo vai thì nó tự soát trên cặp đã đảo và thấy mọi thứ khớp.
      'Before you finish, check two things. First: the scene, background and setting are the ones from\n' +
        'Image 1. Second: the product shown in it is the one from Image 2, with none of the shape, colours,\n' +
        'logos or lettering of the product from Image 1 anywhere on it. If it came out the other way round —\n' +
        "Image 2's scene showing Image 1's product — you have swapped them; redo it.",
    );
  }

  return blocks.join('\n\n');
}

/** Bóc URL ảnh ra khỏi các kiểu response khác nhau mà Kie.ai từng trả về. */
function extractResultUrl(taskData: any): string | null {
  let result: unknown = taskData?.images ?? taskData?.result ?? taskData?.output ?? taskData?.imageUrl;

  if (!result && typeof taskData?.resultJson === 'string') {
    try {
      const parsed = JSON.parse(taskData.resultJson);
      result = parsed.resultUrls ?? parsed.images ?? parsed.url;
    } catch {
      /* bỏ qua, xử lý ở dưới */
    }
  }

  if (Array.isArray(result)) result = result[0];
  if (result && typeof result === 'object' && 'url' in result) result = (result as { url: unknown }).url;

  return typeof result === 'string' && result.length > 0 ? result : null;
}

export const kieProvider: ImageProvider = {
  name: 'kie',

  isConfigured: () => Boolean(env.kie.apiKey),

  /**
   * Kiểm tra tổ hợp tham số TRƯỚC khi trừ điểm, để khách không bị trừ rồi hoàn
   * cho một lỗi mà ta biết chắc từ đầu là sẽ xảy ra.
   */
  validate({ providerModel, resolution, aspectRatio, imageCount }: ValidateInput): string | null {
    const spec = specFor(providerModel);

    if (spec.imagesRequired && imageCount === 0) {
      return 'This model requires at least one input image.';
    }
    if (imageCount > spec.maxImages) {
      return `This model accepts at most ${spec.maxImages} input images, you sent ${imageCount}.`;
    }
    if (!spec.aspectRatios.includes(aspectRatio)) {
      return `This model does not support the ${aspectRatio} ratio. Supported: ${spec.aspectRatios.join(', ')}.`;
    }
    if (spec.resolutions && !spec.resolutions.includes(resolution)) {
      return `This model does not support ${resolution}. Supported: ${spec.resolutions.join(', ')}.`;
    }

    // Ràng buộc riêng phải xét trên tỉ lệ THẬT SỰ được gửi đi, không phải trên
    // "auto" — nếu không, tổ hợp hợp lệ sau khi quy về 3:4 vẫn bị chặn oan.
    return spec.restrict?.(resolution, resolveAspectRatio(spec, aspectRatio)) ?? null;
  },

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    if (!env.kie.apiKey) {
      providerFailure('Chưa cấu hình KIE_API_KEY trong file .env.', USER_MESSAGE.config, 'provider_not_configured');
    }

    const spec = specFor(request.providerModel);

    // 1. Upload ảnh đầu vào (ảnh mẫu trước, ảnh sản phẩm sau — thứ tự này khớp với prompt)
    const sources = [request.referenceImage, ...request.productImages]
      .filter((image): image is string => Boolean(image))
      .slice(0, spec.maxImages);

    const imageUrls: string[] = [];
    for (const source of sources) imageUrls.push(await uploadImage(source));

    // 2. Dựng payload đúng theo đặc tả của model
    const input: Record<string, unknown> = {
      prompt: buildPrompt(request),
      aspect_ratio: resolveAspectRatio(spec, request.aspectRatio),
    };
    if (imageUrls.length > 0) input[spec.imageParam] = imageUrls;
    if (spec.resolutions) input.resolution = request.resolution;
    if (spec.outputFormat) input.output_format = spec.outputFormat;

    const createData = await requestJson(`${env.kie.baseUrl}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ model: request.providerModel, input }),
    });

    if (createData.code !== 200) {
      providerFailure(`Tạo task bị từ chối: ${createData.msg ?? JSON.stringify(createData)}`);
    }

    const taskId: string | undefined = createData.data?.taskId;
    if (!taskId) providerFailure('Tạo task thành công nhưng không có taskId.');
    await request.onTaskCreated?.(taskId);

    // 3. Chờ kết quả
    const deadline = Date.now() + MAX_POLL_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollData = await requestJson(
        `${env.kie.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        { method: 'GET', headers: authHeaders() },
      );
      if (pollData.code !== 200) {
        providerFailure(`Tra trạng thái task ${taskId} thất bại: ${pollData.msg ?? 'lỗi không rõ'}`);
      }

      const status: string = pollData.data?.status ?? pollData.data?.state ?? '';

      if (status === 'success') {
        const url = extractResultUrl(pollData.data);
        if (!url) providerFailure(`Task ${taskId} báo success nhưng không có URL ảnh.`);
        return { url, taskId };
      }

      if (status === 'fail' || status === 'failed' || status === 'error') {
        const reason = pollData.data?.failReason ?? pollData.data?.error ?? 'không rõ nguyên nhân';
        throw new AppError(502, `Image generation failed: ${reason}`, 'provider_failed');
      }
    }

    providerFailure(`Task ${taskId} quá 6 phút chưa xong.`, USER_MESSAGE.timeout, 'provider_timeout');
  },
};
