<?php
/**
 * Elementor Widget for Cinemana TV Screen.
 *
 * @package Cinemana_TV_Theme
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

class Elementor_Cinemana_TV_Widget extends \Elementor\Widget_Base {

	public function get_name() {
		return 'cinemana_tv_widget';
	}

	public function get_title() {
		return esc_html__( 'Cinemana TV Screen', 'cinemana-tv-theme' );
	}

	public function get_icon() {
		return 'eicon-device-tv';
	}

	public function get_categories() {
		return [ 'general' ];
	}

	public function get_style_depends() {
		return [ 'cinemana-react-styles' ];
	}

	public function get_script_depends() {
		return [ 'cinemana-react-scripts' ];
	}

	protected function register_controls() {
		$this->start_controls_section(
			'content_section',
			[
				'label' => esc_html__( 'Settings', 'cinemana-tv-theme' ),
				'tab' => \Elementor\Controls_Manager::TAB_CONTENT,
			]
		);

		$this->add_control(
			'tv_mode',
			[
				'label' => esc_html__( 'Auto Focus on Load', 'cinemana-tv-theme' ),
				'type' => \Elementor\Controls_Manager::SWITCHER,
				'label_on' => esc_html__( 'Yes', 'cinemana-tv-theme' ),
				'label_off' => esc_html__( 'No', 'cinemana-tv-theme' ),
				'return_value' => 'yes',
				'default' => 'yes',
			]
		);

		$this->end_controls_section();
	}

	protected function render() {
		?>
		<div id="cinemana-tv-theme-elementor-container" class="w-full min-h-screen bg-black overflow-hidden relative">
            <!-- الحاوية الأساسية لتطبيق React سينمانا -->
            <div id="root"></div>
		</div>
		<script>
            document.addEventListener("DOMContentLoaded", function() {
                const container = document.getElementById("cinemana-tv-theme-elementor-container");
                if (container) {
                    container.focus();
                }
            });
        </script>
		<?php
	}
}
