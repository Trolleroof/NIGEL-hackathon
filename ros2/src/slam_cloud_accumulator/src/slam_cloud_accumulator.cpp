#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <std_srvs/srv/trigger.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <tf2_sensor_msgs/tf2_sensor_msgs.hpp>

#include <pcl/point_cloud.h>
#include <pcl/point_types.h>
#include <pcl/filters/voxel_grid.h>
#include <pcl_conversions/pcl_conversions.h>

#include <mutex>
#include <string>
#include <chrono>

using namespace std::chrono_literals;

class SlamCloudAccumulator : public rclcpp::Node
{
public:
  SlamCloudAccumulator()
  : Node("slam_cloud_accumulator"),
    tf_buffer_(this->get_clock()),
    tf_listener_(tf_buffer_),
    scans_since_refilter_(0)
  {
    this->declare_parameter("fixed_frame", "odom");
    this->declare_parameter("input_topic", "/odin1/cloud_slam");
    this->declare_parameter("voxel_size", 0.05);
    this->declare_parameter("publish_hz", 2.0);
    this->declare_parameter("refilter_every_n_scans", 10);

    fixed_frame_            = this->get_parameter("fixed_frame").as_string();
    input_topic_            = this->get_parameter("input_topic").as_string();
    voxel_size_             = static_cast<float>(this->get_parameter("voxel_size").as_double());
    publish_hz_             = this->get_parameter("publish_hz").as_double();
    refilter_every_n_scans_ = this->get_parameter("refilter_every_n_scans").as_int();

    accumulated_cloud_ = std::make_shared<pcl::PointCloud<pcl::PointXYZRGB>>();
    voxel_.setLeafSize(voxel_size_, voxel_size_, voxel_size_);

    // Live cloud topic — reliable, depth 2; compatible with RViz and future frontends
    cloud_pub_ = this->create_publisher<sensor_msgs::msg::PointCloud2>(
      "/slam_cloud_accumulator/cloud", rclcpp::QoS(2).reliable());

    cloud_sub_ = this->create_subscription<sensor_msgs::msg::PointCloud2>(
      input_topic_, rclcpp::SensorDataQoS(),
      std::bind(&SlamCloudAccumulator::cloudCallback, this, std::placeholders::_1));

    auto period_ms = std::chrono::milliseconds(static_cast<int>(1000.0 / publish_hz_));
    publish_timer_ = this->create_wall_timer(
      period_ms, std::bind(&SlamCloudAccumulator::publishCallback, this));

    reset_srv_ = this->create_service<std_srvs::srv::Trigger>(
      "/slam_cloud_accumulator/reset",
      std::bind(&SlamCloudAccumulator::resetCallback, this,
                std::placeholders::_1, std::placeholders::_2));

    RCLCPP_INFO(this->get_logger(),
      "slam_cloud_accumulator started. frame='%s', voxel=%.3f m, publish=%.1f Hz",
      fixed_frame_.c_str(), voxel_size_, publish_hz_);
  }

private:
  // ── Incoming scan ────────────────────────────────────────────────────────────
  void cloudCallback(const sensor_msgs::msg::PointCloud2::SharedPtr msg)
  {
    sensor_msgs::msg::PointCloud2 transformed;
    try {
      transformed = tf_buffer_.transform(*msg, fixed_frame_, tf2::durationFromSec(0.1));
    } catch (const tf2::TransformException & ex) {
      RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 2000,
        "TF transform failed: %s", ex.what());
      return;
    }

    pcl::PointCloud<pcl::PointXYZRGB> new_cloud;
    pcl::fromROSMsg(transformed, new_cloud);

    // Downsample the incoming scan before merging — keeps point density uniform
    // and prevents any single scan from flooding the accumulated cloud.
    pcl::PointCloud<pcl::PointXYZRGB> scan_filtered;
    voxel_.setInputCloud(new_cloud.makeShared());
    voxel_.filter(scan_filtered);

    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      *accumulated_cloud_ += scan_filtered;
      scans_since_refilter_++;

      // Periodically re-filter the whole accumulated cloud.
      // This collapses duplicate/ghost points that pile up from SLAM drift
      // and loop-closure corrections: once corrected scans land in the same
      // voxel as the old ghost points, a single voxel-grid pass merges them.
      if (scans_since_refilter_ >= refilter_every_n_scans_) {
        pcl::PointCloud<pcl::PointXYZRGB> refiltered;
        voxel_.setInputCloud(accumulated_cloud_);
        voxel_.filter(refiltered);
        *accumulated_cloud_ = std::move(refiltered);
        scans_since_refilter_ = 0;
        RCLCPP_DEBUG(this->get_logger(),
          "Re-filtered accumulated cloud: %zu points", accumulated_cloud_->size());
      }
    }
  }

  // ── Publish timer ────────────────────────────────────────────────────────────
  void publishCallback()
  {
    if (cloud_pub_->get_subscription_count() == 0) return;

    sensor_msgs::msg::PointCloud2 out_msg;
    {
      std::lock_guard<std::mutex> lock(cloud_mutex_);
      if (accumulated_cloud_->empty()) return;
      pcl::toROSMsg(*accumulated_cloud_, out_msg);
    }
    out_msg.header.frame_id = fixed_frame_;
    out_msg.header.stamp    = this->now();
    cloud_pub_->publish(out_msg);
  }

  // ── Reset service ────────────────────────────────────────────────────────────
  void resetCallback(
    const std::shared_ptr<std_srvs::srv::Trigger::Request> /*req*/,
    std::shared_ptr<std_srvs::srv::Trigger::Response> response)
  {
    std::lock_guard<std::mutex> lock(cloud_mutex_);
    accumulated_cloud_->clear();
    scans_since_refilter_ = 0;
    response->success = true;
    response->message = "Accumulated cloud cleared.";
    RCLCPP_INFO(this->get_logger(), "Accumulated cloud reset.");
  }

  // ── Members ──────────────────────────────────────────────────────────────────
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr    cloud_pub_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr cloud_sub_;
  rclcpp::TimerBase::SharedPtr                                   publish_timer_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr             reset_srv_;

  tf2_ros::Buffer            tf_buffer_;
  tf2_ros::TransformListener tf_listener_;

  // Reused voxel filter instance — setLeafSize called once at startup
  pcl::VoxelGrid<pcl::PointXYZRGB> voxel_;

  pcl::PointCloud<pcl::PointXYZRGB>::Ptr accumulated_cloud_;
  std::mutex cloud_mutex_;
  int        scans_since_refilter_;

  std::string fixed_frame_;
  std::string input_topic_;
  float       voxel_size_;
  double      publish_hz_;
  int         refilter_every_n_scans_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<SlamCloudAccumulator>());
  rclcpp::shutdown();
  return 0;
}
