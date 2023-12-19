# Infrastructure as Code with Pulumi

This Pulumi project is designed to set up a robust cloud infrastructure on AWS, incorporating various services like EC2, RDS, VPC, Auto Scaling, Load Balancer, CloudWatch, DynamoDB, Simple Notification Systems, Route53 and more. It also integrates with GCP for storage bucket creation. The project aims to provide a comprehensive infrastructure setup for hosting a web application.

# Pre-requisites

Before running this code, ensure you have the following installed:

- [Pulumi](https://www.pulumi.com/docs/install/)
- [AWS CLI](https://aws.amazon.com/cli/)
- [GCP CLI](https://cloud.google.com/sdk/docs/install)
- Node.js and npm

You also need to have AWS and GCP accounts and have configured your CLI tools with appropriate credentials.

# Configurations

Set up the required configuration variables using Pulumi's configuration system. You need to provide values for the following keys:

- vpcCidr
- region
- subnetCount (optional, defaults to 3)
- publicSubnetBaseCIDR
- privateSubnetBaseCIDR
- vpcName
- internetGatewayName
- publicrouteName
- privaterouteName
- dbPassword (as a secret)
- dbUser
- dbPostgresql
- mailgunkey (as a secret)
- GCP_PROJECT_ID
- hostedZoneId

You can set these configurations using the Pulumi CLI. For example, to set the vpcCidr, use the following command:
```
pulumi config set vpcCidr <your-vpc-cidr>
```

For secret values like dbPassword, use:
```
pulumi config set --secret dbPassword <your-db-password>
```

## Running code with Pulumi commands

- Initialize a New Project:
  ```
  pulumi new aws-typescript
  ```
- Preview and Deploy
  ```
  pulumi up
  ```
- Delete created resources and refresh
  ```
  pulumi destroy
  pulumi refresh
  ```

# AWS Resources

## Virtual Private Cloud
- **Purpose**: Acts as a virtual network isolated from other networks in the cloud. It's the backbone for deploying AWS resources. 
- Created a new VPC named "myVPC" with specified CIDR block.

## Internet Gateway
- **Purpose**: Allows communication between your VPC and the internet.
- Created a new Internet Gateway named "myInternetGateway" and attached it to the VPC.

## Availability Zones
- Queried and obtained the first three availability zones.

## Subnets
- **Purpose**: Subnets divide VPC into smaller, manageable sections. Public subnets have routes to the internet, while private subnets are isolated.
- Created public and private subnets in each availability zone.
- Associated route tables with subnets.

## Route Tables
- **Purpose**: Define rules to direct network traffic from subnets to external destinations
- Created public and private route tables.
- Associated subnets with route tables.

## Security Groups
- **Purpose**: Act as virtual firewalls to control inbound and outbound traffic to AWS resources.
- Created security groups for load balancer, EC2 instances, and RDS instance.

## RDS (Relational Database Service)
- **Purpose**: Provides scalable and managed database services.
- PostgreSQL database instance is set up with configurations like instance class, storage, and credentials. It's placed in private subnets for security and is associated with a security group that restricts access.

## IAM (Identity and Access Management)
- **Purpose**: Define permissions for AWS services and resources.
- Specific roles and policies are created for the CloudWatch agent and Lambda functions, granting them necessary permissions.

## EC2 Instances setup
- Components
  - **Auto Scaling Group**: Manages the scaling of EC2 instances based on defined criteria.
  - **Launch Template**: Defines the configuration for instances launched by the auto-scaling group.
  - **Load Balancer**: Distributes incoming application traffic across multiple instances.Configured listeners and target groups.
  - **CloudWatch Monitoring**: Collects and tracks metrics, monitors log files, and sets alarms.
  
## AWS Lambda
-  **Purpose**: Runs backend code in response to events like HTTP requests, database changes, etc., without provisioning or managing servers.
-  A Lambda function is configured with an IAM role, runtime environment, and handler settings. 
-  It's triggered by AWS SNS messages.

## AWS SNS
- **Purpose**: SNS (Simple Notification Service) is used for building and integrating loosely-coupled, distributed applications.
- An SNS topic is created for sending messages, and the Lambda function is subscribed to this topic.

## Route53 DNS
- **Purpose**: Manages DNS records and routes users to Internet applications.
- An A record is set up in a Route53 hosted zone to map a domain name to the AWS resource - Load Balancer.

## AWS DynamoDB Table
- **Purpose**: Provides a NoSQL database service that supports key-value and document data structures.
- A DynamoDB table is created with specified attributes, keys, and billing mode.

## CloudWatch Alarms and Scaling Policies
- **Purpose**: Monitor AWS resources and applications, triggering alarms and scaling actions based on defined metrics.
- CloudWatch alarms are set up to trigger scaling policies for the auto-scaling group, scaling up or down based on CPU utilization.

# GCP Resources

## GCP Storage Bucket
- **Purpose**: Provides object storage on Google Cloud Platform.
- A storage bucket named "csye6225_demo_gcs_bucket" with versioning enabled is created in GCP, along with a service account for access management. IAM bindings ensure the service account has necessary permissions on the bucket.

# Outputs
- Exported various resource IDs and information for reference and integration with other services.