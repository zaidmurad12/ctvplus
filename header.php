<!DOCTYPE html>
<html <?php language_attributes(); ?> class="bg-black text-white m-0 p-0 overflow-x-hidden">
<head>
    <meta charset="<?php bloginfo( 'charset' ); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="profile" href="https://gmpg.org/xfn/11">
    <?php wp_head(); ?>
    <style>
        /* إخفاء شريط أدوات ووردبريس العلوي على شاشات التلفزيون لتجنب التشويه البصري */
        @media screen and (max-width: 600px) {
            #wpadminbar { display: none !important; }
            html { margin-top: 0 !important; }
        }
        html, body {
            background-color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100%;
            height: 100%;
            overflow-x: hidden;
        }
    </style>
</head>
<body <?php body_class('bg-black text-white m-0 p-0'); ?>>
<?php wp_body_open(); ?>
