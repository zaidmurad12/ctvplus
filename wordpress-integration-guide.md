# دليل تحويل تطبيق سينمانا التلفزيوني إلى قالب ووردبريس (WordPress + Elementor) متوافق مع Android TV

للحفاظ على **التصميم الدقيق بنسبة 100%**، وسرعة الأداء، ونظام التنقل الذكي باستخدام أزرار التحكم (Remote Control) لـ Android TV، فإن الخيار الاحترافي والوحيد هو **عدم إعادة كتابة التطبيق بالكامل بلغات PHP/HTML التقليدية الخاصة بووردبريس** (لأن Elementor لا يدعم برمجة تنقل أزرار التلفاز والكيبورد الافتراضي بشكل افتراضي).

الحل الأمثل هو **دمج تطبيق React (Vite) الحالي كعنصر (Widget) مخصص داخل Elementor** عبر إضافة (Plugin) ووردبريس خاصة، مما يتيح لك سحب وإفلات التطبيق في أي صفحة تريدها مع الحفاظ على الكود الفعلي كاملاً.

---

## 🛠️ الطريقة الاحترافية: إضافة ووردبريس مخصصة لـ Elementor (React Widget Plugin)

سنقوم بإنشاء إضافة ووردبريس تقوم بـ:
1. تسجيل عنصر جديد في Elementor باسم **Cinemana TV Widget**.
2. جلب ملفات الـ JavaScript والـ CSS الخاصة بتطبيق React بعد عمل `build` له.
3. حقن التطبيق داخل صفحة الووردبريس ليعمل بكامل طاقته ومميزاته وتوافقه مع شاشات التلفزيون.

---

### الخطوة 1: تجهيز ملفات التطبيق (React Build)
قم بتشغيل الأمر التالي في مشروعك للحصول على النسخة النهائية المترجمة:
```bash
npm run build
```
سينتج عن ذلك مجلد باسم `dist` يحتوي على:
- ملفات الـ JS (مثال: `assets/index-XXXX.js`)
- ملفات الـ CSS (مثال: `assets/index-XXXX.css`)

---

### الخطوة 2: إنشاء ملف الإضافة في ووردبريس (WordPress Plugin)
قم بإنشاء مجلد في موقع ووردبريس الخاص بك في المسار التالي:
`wp-content/plugins/cinemana-tv-elementor/`

بداخل هذا المجلد، أنشئ ملفاً باسم `cinemana-tv-elementor.php` وضع فيه الكود التالي:

```php
<?php
/**
 * Plugin Name: Cinemana TV App for Elementor
 * Description: دمج تطبيق سينمانا التلفزيوني المتوافق مع Android TV كعنصر مخصص داخل Elementor.
 * Version: 1.0.0
 * Author: AI Studio
 * Text Domain: cinemana-tv
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// 1. تسجيل عنصر Elementor المخصص
function register_cinemana_tv_widget( $widgets_manager ) {
	require_once( __DIR__ . '/widgets/cinemana-tv-widget.php' );
	$widgets_manager->register( new \Elementor_Cinemana_TV_Widget() );
}
add_action( 'elementor/widgets/register', 'register_cinemana_tv_widget' );

// 2. تحميل ملفات الـ JS والـ CSS الخاصة بالتطبيق
function enqueue_cinemana_tv_assets() {
    // قم بنسخ ملفات مجلد assets من الـ build وضعها داخل مجلد الإضافة في wp-content/plugins/cinemana-tv-elementor/assets/
    
    // تسجيل ملف الـ CSS
    wp_register_style(
        'cinemana-tv-styles',
        plugins_url( 'assets/index.css', __FILE__ ),
        array(),
        '1.0.0'
    );

    // تسجيل ملف الـ JS (بصيغة Module)
    wp_register_script(
        'cinemana-tv-scripts',
        plugins_url( 'assets/index.js', __FILE__ ),
        array(),
        '1.0.0',
        true
    );
    
    // إضافة ووردبريس لدعم تحميل السكريبت كـ Module
    add_filter( 'script_loader_tag', function ( $tag, $handle, $src ) {
        if ( 'cinemana-tv-scripts' !== $handle ) {
            return $tag;
        }
        return '<script type="module" src="' . esc_url( $src ) . '"></script>';
    }, 10, 3 );
}
add_action( 'wp_enqueue_scripts', 'enqueue_cinemana_tv_assets' );
```

---

### الخطوة 3: إنشاء عنصر تحكم Elementor
أنشئ مجلداً فرعياً باسم `widgets` داخل مجلد الإضافة، ثم أنشئ ملفاً باسم `cinemana-tv-widget.php` وضع فيه الكود التالي:

```php
<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Elementor_Cinemana_TV_Widget extends \Elementor\Widget_Base {

	public function get_name() {
		return 'cinemana_tv_widget';
	}

	public function get_title() {
		return esc_html__( 'Cinemana TV Screen', 'cinemana-tv' );
	}

	public function get_icon() {
		return 'eicon-device-tv';
	}

	public function get_categories() {
		return [ 'general' ];
	}

	public function get_style_depends() {
		return [ 'cinemana-tv-styles' ];
	}

	public function get_script_depends() {
		return [ 'cinemana-tv-scripts' ];
	}

	protected function register_controls() {
		// هنا يمكنك إضافة إعدادات التحرير عبر Elementor إذا أردت (مثل تغيير الألوان أو الروابط)
        $this->start_controls_section(
			'content_section',
			[
				'label' => esc_html__( 'Settings', 'cinemana-tv' ),
				'tab' => \Elementor\Controls_Manager::TAB_CONTENT,
			]
		);

		$this->add_control(
			'tv_mode',
			[
				'label' => esc_html__( 'TV Navigation Mode', 'cinemana-tv' ),
				'type' => \Elementor\Controls_Manager::SWITCHER,
				'label_on' => esc_html__( 'Active', 'cinemana-tv' ),
				'label_off' => esc_html__( 'Inactive', 'cinemana-tv' ),
				'return_value' => 'yes',
				'default' => 'yes',
			]
		);

		$this->end_controls_section();
	}

	protected function render() {
		// هذا هو الكود الأساسي الذي سينطلق منه تطبيق React داخل موقع الووردبريس
		?>
		<div id="cinemana-tv-container" class="w-full min-h-screen bg-black overflow-hidden relative">
            <!-- التطبيق سيتحمل داخل الـ Root الرئيسي -->
            <div id="root"></div>
		</div>
		<script>
            // لضمان عمل الكيبورد والتنقل بالتلفاز بمجرد الدخول للصفحة
            document.addEventListener("DOMContentLoaded", function() {
                const container = document.getElementById("cinemana-tv-container");
                if (container) {
                    container.focus();
                }
            });
        </script>
		<?php
	}
}
```

---

## 📱 التوافق التام مع Android TV (كيف يعمل الريموت في ووردبريس؟)

تطبيقنا الحالي مبني ليتفاعل مع كود لوحة المفاتيح والأزرار القياسية للريموت كونترول:
- **السهم الأعلى (ArrowUp)** / **السهم الأسفل (ArrowDown)**
- **السهم الأيمن (ArrowRight)** / **السهم الأيسر (ArrowLeft)**
- **زر الإدخال (Enter / OK)**
- **زر الرجوع (Escape / Back)**

بما أننا قمنا بدمجه مباشرة داخل صفحة الووردبريس، فبمجرد تحميل الصفحة سيقوم تطبيق React بالاستماع لجميع نقرات أزرار الريموت والتحكم بالتنقل بدقة متناهية وسلاسة تامة دون أي تداخل مع باقي عناصر ووردبريس.

---

## 🚀 كيفية تشغيل وتجربة الإضافة الآن:
1. قم بضغط المجلد `cinemana-tv-elementor` بعد وضع ملفات الـ JS والـ CSS التي استخرجتها من مجلد `dist` بداخله في مجلد فرعي باسم `assets` (وتأكد من تسميتها `index.js` و `index.css`).
2. اذهب إلى لوحة تحكم ووردبريس -> **الاضافات (Plugins)** -> **أضف جديد (Add New)** -> قم برفع ملف الـ ZIP وتفعيله.
3. افتح أي صفحة باستخدام **Elementor**، وابحث في العناصر عن **Cinemana TV Screen** ثم اسحبه إلى الصفحة واجعل الصفحة بعرض كامل (Elementor Canvas) لتبدو كشاشة تلفزيون حقيقية مذهلة!
