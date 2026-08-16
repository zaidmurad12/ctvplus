# WordPress Integration Guide | دليل النشر والدمج مع ووردبريس

This guide explains how to deploy, embed, or run the **Cinemana Smart TV Player** template on a WordPress website.

يوضح هذا الدليل كيفية نشر وتضمين أو تشغيل قالب **سينمانا للتلفزيون الذكي** على أي موقع ووردبريس بكل سهولة واحترافية.

---

## Method 1: The Instant Iframe Embed (Recommended)
### الطريقة الأولى: التضمين الفوري عبر الإطار المباشر (موصى بها وسهلة)

The easiest, most robust way is to build and host your React app on Cloud Run (which is already done for you!), then embed it inside any WordPress page or post using an `<iframe>` block. This ensures that the app runs in its native sandboxed state, has zero styling conflicts with your WordPress theme, and retains perfect responsiveness.

الطريقة الأسهل والأكثر استقراراً هي بناء واستضافة تطبيق React على منصة سحابية (والتي تم إعدادها لك بالفعل!)، ثم تضمين التطبيق داخل أي صفحة أو مقالة في ووردبريس باستخدام كود `<iframe>`. يضمن ذلك تشغيل التطبيق في بيئة معزولة، بدون أي تداخل في التصميم مع قالب ووردبريس، مع الحفاظ على استجابة مرنة كاملة للهواتف والشاشات.

### Steps / خطوات التطبيق:
1. Copy the following HTML embed code:
   انسخ كود الـ HTML التالي للتضمين:
   
   ```html
   <div class="cinemana-embed-wrapper" style="width: 100%; max-width: 1200px; margin: 0 auto; overflow: hidden; border-radius: 20px; box-shadow: 0 20px 50px rgba(0,0,0,0.85); background: #000;">
       <iframe src="https://YOUR_APP_URL" style="width: 100%; height: 720px; border: none;" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerPolicy="no-referrer"></iframe>
   </div>
   ```
2. Replace `https://YOUR_APP_URL` with your live preview link.
   استبدل الرابط `https://YOUR_APP_URL` برابط المعاينة المباشر للتطبيق الخاص بك.
3. In your WordPress Dashboard, open the Page or Post editor.
   من لوحة تحكم ووردبريس، افتح محرّر الصفحات أو المقالات.
4. Add a **Custom HTML** block (أضف مكون HTML مخصص) and paste the code.
5. Publish the page.
   قم بنشر الصفحة واستمتع بالنتيجة!

---

## Method 2: Installing as a Standalone WordPress Plugin
### الطريقة الثانية: التثبيت كإضافة ووردبريس مستقلة بالكامل

If you prefer to host all assets directly on your WordPress server, we have pre-packaged a fully functional WordPress Plugin file `wp-cinemana-embed.php` for you in this workspace.

إذا كنت تفضل استضافة كافة ملفات البرمجة والصور محلياً على خادم موقع ووردبريس الخاص بك مباشرة، فقد قمنا بتجهيز ملف إضافة ووردبريس متكامل ومستقل باسم `wp-cinemana-embed.php` داخل هذا المجلد.

### Steps / خطوات التثبيت:
1. Run a production build of the React app in your workspace:
   قم ببناء نسخة الإنتاج من تطبيق React عبر تشغيل الأمر التالي:
   ```bash
   npm run build
   ```
   This creates a optimized production bundle inside the `dist/` directory.
   سيقوم هذا بإنشاء مجلد `dist/` الذي يحتوي على كافة أكواد التطبيق المدمجة والسريعة للغاية.

2. Create a folder on your computer named `cinemana-tv-embedder`.
   أنشئ مجلدًا على جهازك الشخصي باسم `cinemana-tv-embedder`.

3. Move the following files into that folder:
   انقل الملفات التالية إلى داخل المجلد المنشأ:
   - `wp-cinemana-embed.php` (The main WordPress plugin file / ملف الإضافة الرئيسي للووردبريس)
   - The entire `dist` directory (contains assets, index.html, JS and CSS builds)

4. Compress the folder into a single ZIP file (`cinemana-tv-embedder.zip`).
   اضغط المجلد بالكامل بصيغة ZIP ليصبح الملف جاهزاً للرفع باسم (`cinemana-tv-embedder.zip`).

5. Upload & Install to WordPress:
   رفع وتثبيت الإضافة في ووردبريس:
   - Go to **WordPress Admin Panel** > **Plugins** > **Add New** > **Upload Plugin**.
     توجه إلى **لوحة تحكم ووردبريس** > **الاضافات** > **أضف جديد** > **رفع إضافة**.
   - Select the `cinemana-tv-embedder.zip` file, click **Install Now**, and then **Activate**.
     اختر ملف ZIP المضغوط، واضغط **التثبيت الآن**، ثم قم بـ **تفعيل الإضافة**.

6. Display on your site:
   عرض المشغل في موقعك:
   - Paste the shortcode `[cinemana_tv_player]` on any page, and it will automatically mount the app on that page with zero external hosting!
     انسخ الكود القصير `[cinemana_tv_player]` وضعه في أي مكان داخل صفحتك، وسيظهر لك المشغل بشكل فوري ومستقل تماماً!
   - You can customize sizes like: `[cinemana_tv_player width="100%" height="800px"]`.
     يمكنك تخصيص الأبعاد مثلاً: `[cinemana_tv_player width="100%" height="800px"]`.

---

## Theme & Layout Settings
### إعدادات المظهر والتصميم

- **Autoplay Support**: Most modern browsers block video autoplay unless muted. The shortcode includes proper iframe permissions to enable user-triggered full screen and high-fidelity autoplay when ready.
- **Pure Black Canvas**: The player renders inside a pure black canvas to minimize eye strain and replicate an authentic smart TV theater experience.
- **دعم التشغيل التلقائي**: تمنع المتصفحات الحديثة التشغيل التلقائي للصوت مباشرة، لذلك تتضمن الإضافة أذونات تشغيل متكاملة تمكن المستخدم من تفعيل ملء الشاشة والصوت عالي الدقة بلمسة واحدة.
- **مسرح أسود بالكامل**: تم تصميم خلفية المشغل لتكون سوداء بالكامل لراحة العين ومحاكاة تجربة دور العرض في الشاشات الذكية بنقاوة بصرية فائقة.
