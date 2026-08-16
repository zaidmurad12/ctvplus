<?php
/**
 * The main template file for Cinemana TV Theme.
 *
 * @package Cinemana_TV_Theme
 */

get_header(); ?>

<div id="cinemana-tv-theme-container" class="w-full min-h-screen bg-black overflow-hidden relative">
    <!-- Always guarantee root element exists so React app can mount instantly -->
    <div id="root"></div>
    
    <?php
    // We execute the standard loop in a hidden container to support plugin hooks/SEO without interrupting the React UI
    if ( have_posts() ) {
        echo '<div style="display:none !important;">';
        while ( have_posts() ) {
            the_post();
            the_content();
        }
        echo '</div>';
    }
    ?>
</div>

<script>
    // تفعيل التركيز التلقائي على حاوية التطبيق فور تحميل الصفحة لتسهيل التحكم بالريموت
    document.addEventListener("DOMContentLoaded", function() {
        const container = document.getElementById("cinemana-tv-theme-container");
        if (container) {
            container.focus();
        }
    });
</script>

<?php get_footer(); ?>
