<?php
/**
 * Plugin Name: Cinemana TV Embedder
 * Plugin URI: https://ai.studio/build
 * Description: A premium, high-fidelity responsive Smart TV video player template for Cinemana movies and series, designed with an Android TV/Apple TV-like fluid interface.
 * Version: 1.0.0
 * Author: AI Coding Agent
 * Author URI: https://ai.studio/build
 * License: GPL2
 * Arabic Description: إضافة ووردبريس لتضمين وعرض تطبيق سينمانا المشابه لشاشات التلفزيون الذكية بخصائص تحكم كاملة وسلسة.
 */

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Register the shortcode [cinemana_tv_player]
 * This shortcode can be placed on any WordPress page or post to render the TV player.
 */
function cinemana_tv_player_shortcode( $atts ) {
    // Merge user attributes with defaults
    $atts = shortcode_atts( array(
        'width'  => '100%',
        'height' => '720px',
        'url'    => '', // Leave blank to use local resources, or specify external URL
    ), $atts, 'cinemana_tv_player' );

    // If an external hosted URL is provided, embed it directly via iframe (The easiest and most responsive way)
    if ( ! empty( $atts['url'] ) ) {
        $embed_url = esc_url( $atts['url'] );
        return "<div class='cinemana-tv-container' style='width: {$atts['width']}; height: {$atts['height']}; overflow: hidden; border-radius: 16px; background: #000; box-shadow: 0 20px 50px rgba(0,0,0,0.8);'>
                    <iframe src='{$embed_url}' style='width: 100%; height: 100%; border: none;' allow='autoplay; fullscreen; encrypted-media; picture-in-picture' allowfullscreen referrerPolicy='no-referrer'></iframe>
                </div>";
    }

    // Otherwise, embed via custom HTML container that loads the built files
    $plugin_url = plugin_dir_url( __FILE__ );
    
    // Register & Enqueue Styles
    wp_register_style( 'cinemana-font-cairo', 'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&display=swap' );
    wp_enqueue_style( 'cinemana-font-cairo' );

    // Inline style wrapper to reset margins and style the black stage
    $output = "
    <div id='cinemana-tv-wp-app' class='cinemana-tv-theme-dark' style='width: {$atts['width']}; height: {$atts['height']}; background-color: #000; position: relative; overflow: hidden; border-radius: 20px; box-shadow: 0 25px 60px rgba(0,0,0,0.85); font-family: Cairo, sans-serif;'>
        <!-- The React Application Root -->
        <div id='root' style='width: 100%; height: 100%;'></div>
    </div>";

    // Enqueue React built scripts and style sheets
    // Locate JS and CSS files in build directory
    $js_files = glob( plugin_dir_path( __FILE__ ) . 'dist/assets/*.js' );
    $css_files = glob( plugin_dir_path( __FILE__ ) . 'dist/assets/*.css' );

    if ( ! empty( $js_files ) ) {
        $js_name = basename( $js_files[0] );
        wp_enqueue_script( 'cinemana-react-app', $plugin_url . 'dist/assets/' . $js_name, array(), '1.0.0', true );
    }
    
    if ( ! empty( $css_files ) ) {
        $css_name = basename( $css_files[0] );
        wp_enqueue_style( 'cinemana-react-style', $plugin_url . 'dist/assets/' . $css_name, array(), '1.0.0' );
    }

    return $output;
}
add_shortcode( 'cinemana_tv_player', 'cinemana_tv_player_shortcode' );

/**
 * Add clean custom styling rules inside head for the shortcode container
 */
function cinemana_tv_player_styles() {
    echo "
    <style>
        .cinemana-tv-container iframe {
            background: #000000;
        }
        /* Lock pointer-events when navigating on TV if necessary */
        #cinemana-tv-wp-app {
            user-select: none;
            -webkit-font-smoothing: antialiased;
        }
    </style>
    ";
}
add_action( 'wp_head', 'cinemana_tv_player_styles' );
