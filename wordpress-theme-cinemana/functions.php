<?php
/**
 * Cinemana TV Theme functions and definitions.
 *
 * @package Cinemana_TV_Theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

// 1. دعم الميزات الأساسية في القالب
function cinemana_tv_theme_setup() {
    add_theme_support( 'title-tag' );
    add_theme_support( 'post-thumbnails' );
    add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
    
    // إضافة دعم للتخطيطات المتوافقة مع Elementor بكامل الشاشة
    add_theme_support( 'elementor-force-full-width' );
}
add_action( 'after_setup_theme', 'cinemana_tv_theme_setup' );

// 2. تسجيل ملفات الـ JS والـ CSS المجمعة من تطبيق React
function cinemana_tv_theme_scripts() {
    // تحميل التنسيق الرئيسي للقالب
    wp_enqueue_style( 'cinemana-main-style', get_stylesheet_uri() );

    // تحميل تنسيقات تطبيق React (تأكد من نسخ ملف index.css إلى مجلد assets داخل القالب)
    wp_enqueue_style(
        'cinemana-react-styles',
        get_template_directory_uri() . '/assets/index.css',
        array(),
        '1.0.2'
    );

    // تحميل كود تشغيل تطبيق React (تأكد من نسخ ملف index.js إلى مجلد assets داخل القالب)
    wp_enqueue_script(
        'cinemana-react-scripts',
        get_template_directory_uri() . '/assets/index.js',
        array(),
        '1.0.2',
        true
    );

    // إضافة فلتر لدعم تحميل السكريبت كـ Module ليعمل تطبيق React بنجاح
    add_filter( 'script_loader_tag', function ( $tag, $handle, $src ) {
        if ( 'cinemana-react-scripts' !== $handle ) {
            return $tag;
        }
        return '<script type="module" src="' . esc_url( $src ) . '"></script>';
    }, 10, 3 );
}
add_action( 'wp_enqueue_scripts', 'cinemana_tv_theme_scripts' );

// 3. تسجيل عنصر (Widget) خاص بـ Elementor مدمج داخل القالب تلقائياً إذا كان Elementor مفعلاً
function register_cinemana_elementor_widgets( $widgets_manager ) {
    $widget_path = get_template_directory() . '/widgets/cinemana-tv-widget.php';
    if ( file_exists( $widget_path ) ) {
        require_once( $widget_path );
        $widgets_manager->register( new \Elementor_Cinemana_TV_Widget() );
    }
}
add_action( 'elementor/widgets/register', 'register_cinemana_elementor_widgets' );
